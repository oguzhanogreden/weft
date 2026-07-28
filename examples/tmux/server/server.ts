/**
 * PTY-over-WebSocket backend for the `examples/tmux` demo.
 *
 * One WebSocket connection == one pane == one shell PTY (read-write), or one
 * read-only `tmux attach -r` (a viewer, see `src/specs.md`, AC-STREAM). Wire
 * protocol:
 *   - client -> server: JSON text frames
 *       { type: "input", data: string }         keystrokes
 *       { type: "resize", cols: number, rows: number }
 *   - server -> client: binary frames = raw PTY output bytes; one JSON text
 *     frame, `{ type: "view-token", token: string }`, sent once to a
 *     read-write connection if `PTY_VIEW_TOKEN` is configured (AC-STREAM)
 *
 * Initial size comes from the `?cols=&rows=` query string. Closing the socket
 * kills the shell, so no PTY outlives its pane.
 *
 * Plain Node, intentionally outside the Vite/workspace build (`node-pty` is a
 * native addon). Run standalone: `cd examples/tmux/server && npm install && npm start`.
 * `startServer` is exported so the integration test can bind an ephemeral port.
 */

import { timingSafeEqual } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node-pty";
import { WebSocketServer } from "ws";

// Diagnostic: set CAPTURE_PTY=<file> to record the raw PTY output stream (exactly
// what the browser emulator receives) for offline analysis / test fixtures. Each
// connection writes its own timestamped file derived from the base, so panes and
// reconnects (e.g. `tmux attach`) never clobber each other. Off by default, so it
// costs nothing when unset.
const CAPTURE_PTY = process.env.CAPTURE_PTY || null;

/** A per-connection capture path: the CAPTURE_PTY base with a sortable timestamp inserted. */
function captureFile(base: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const ext = extname(base) || ".log";
	return join(dirname(base), `${basename(base, ext)}-${stamp}${ext}`);
}

/** A running backend: its bound address, port, and a graceful shutdown. */
export interface PtyServer {
	readonly port: number;
	/** The interface actually bound, e.g. `127.0.0.1`. Lets a test prove the bind is loopback-only. */
	readonly address: string;
	readonly close: () => Promise<void>;
}

/**
 * Whether a connection may proceed. `expected` null means no `PTY_TOKEN` is
 * configured and every connection is allowed. Otherwise `provided` must match
 * exactly, compared in constant time so a wrong guess cannot be timed (see
 * `src/specs.md`, AC-REMOTE).
 */
export function checkToken(expected: string | null, provided: string | null): boolean {
	if (expected === null) return true;
	if (provided === null) return false;
	const expectedBuf = Buffer.from(expected);
	const providedBuf = Buffer.from(provided);
	// timingSafeEqual throws on unequal-length buffers; short-circuiting here is
	// unavoidable (it needs equal lengths to compare), and the length itself is
	// not the secret being protected.
	if (expectedBuf.length !== providedBuf.length) return false;
	return timingSafeEqual(expectedBuf, providedBuf);
}

/** A shell to spawn: the executable and its argument list. */
export interface ShellCommand {
	readonly command: string;
	readonly args: readonly string[];
}

/** One client->server control frame: a keystroke, or a resize request. */
export type ClientMessage =
	| { readonly type: "input"; readonly data: string }
	| { readonly type: "resize"; readonly cols: number; readonly rows: number };

/**
 * Parse one client control frame. `null` for anything that is not a
 * recognized {@link ClientMessage}, malformed JSON included, all treated the
 * same as before: ignored, never a thrown error.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const msg = parsed as Record<string, unknown>;
	if (msg.type === "input" && typeof msg.data === "string") {
		return { type: "input", data: msg.data };
	}
	if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
		return { type: "resize", cols: msg.cols, rows: msg.rows };
	}
	return null;
}

/** Which access a connection gets: read-write (presenter) or read-only (viewer). */
export type ConnectionRole = "presenter" | "viewer";

/**
 * Which role, if any, `provided` grants. Checked against the view token
 * first, so an explicit view-token match always yields `"viewer"` even when
 * `presenterToken` is unset (open access): an explicit read-only credential
 * should not silently upgrade to read-write just because presenter access
 * happens to be open. Falls back to `checkToken`'s existing behavior for
 * `"presenter"`. `null` means neither matched: reject the connection (see
 * `src/specs.md`, AC-STREAM).
 *
 * Implemented here rather than left `declare`d: `startServer`'s connection
 * handler calls this on every connection, including in the already-passing
 * AC-REMOTE tests, so a bodyless stub would throw the moment any of them ran.
 */
export function resolveRole(
	presenterToken: string | null,
	viewToken: string | null,
	provided: string | null,
): ConnectionRole | null {
	if (viewToken !== null && provided !== null && checkToken(viewToken, provided)) return "viewer";
	if (checkToken(presenterToken, provided)) return "presenter";
	return null;
}

/**
 * The shell command for a new connection. For `"viewer"`, attaches read-only
 * to the named session (`tmux attach -t <name> -r`); the caller must already
 * have verified `env.TMUX_SESSION` is set before choosing this role, since
 * there is no session to attach to otherwise (see `src/specs.md`, AC-STREAM).
 * For `"presenter"`, spawns `tmux new -A -s <name>` when `TMUX_SESSION` is
 * set, so a dropped socket's reconnect re-attaches to the same session
 * instead of starting a fresh one, otherwise spawns `SHELL` with no
 * arguments, today's default behavior (see `src/specs.md`, AC-REMOTE).
 */
export function resolveShellCommand(env: NodeJS.ProcessEnv, role: ConnectionRole): ShellCommand {
	const session = env.TMUX_SESSION;
	if (role === "viewer") return { command: "tmux", args: ["attach", "-t", session!, "-r"] };
	if (session) return { command: "tmux", args: ["new", "-A", "-s", session] };
	return { command: env.SHELL ?? "bash", args: [] };
}

// node-pty's own `_sanitizeEnv` list. It only runs when handed `process.env`
// by reference identity (`opt.env === process.env` in unixTerminal), so
// building a copy here silently disables it; strip the same keys ourselves or
// a server started inside tmux/screen would leak `$TMUX`/`$STY` and the child
// `tmux new` would refuse to nest.
const PTY_SANITIZED_KEYS = [
	"TMUX",
	"TMUX_PANE",
	"STY",
	"WINDOW",
	"WINDOWID",
	"TERMCAP",
	"COLUMNS",
	"LINES",
] as const;

/**
 * The spawned shell's environment: the parent's, minus the terminal-nesting
 * variables node-pty would have stripped from a bare `process.env`, plus
 * `COLORTERM=truecolor` so programs emit 24-bit SGR the emulator renders
 * (`src/specs.md`, AC-TRUECOLOR). `TERM` stays `xterm-256color` via the PTY
 * spawn options.
 */
export function spawnEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) out[key] = value;
	}
	for (const key of PTY_SANITIZED_KEYS) delete out[key];
	out.COLORTERM = "truecolor";
	return out;
}

/**
 * Start the backend. Port 0 binds an ephemeral port (used by the test). Binds
 * loopback only: reachability beyond this machine is a proxy's job (a
 * `tailscale serve` mapping), never this process's (see `src/specs.md`,
 * AC-REMOTE).
 */
export function startServer(port = Number(process.env.PORT ?? 8787)): Promise<PtyServer> {
	// Read fresh per call, not hoisted to module scope, so a test can set/unset
	// it around each `startServer` call.
	const ptyToken = process.env.PTY_TOKEN || null;
	const viewToken = process.env.PTY_VIEW_TOKEN || null;
	const tmuxSession = process.env.TMUX_SESSION || null;

	const httpServer = createServer();
	const wss = new WebSocketServer({ server: httpServer });

	wss.on("connection", (socket, request) => {
		const url = new URL(request.url ?? "/", "http://localhost");

		const role = resolveRole(ptyToken, viewToken, url.searchParams.get("token"));
		if (role === null) {
			socket.close(1008, "unauthorized");
			return;
		}
		if (role === "viewer" && tmuxSession === null) {
			socket.close(1008, "viewing requires TMUX_SESSION");
			return;
		}

		const cols = clampDim(url.searchParams.get("cols"), 80);
		const rows = clampDim(url.searchParams.get("rows"), 24);

		const capturePath = CAPTURE_PTY ? captureFile(CAPTURE_PTY) : null;
		if (capturePath) {
			// oxlint-disable-next-line no-console
			console.log(`capturing PTY output to ${capturePath}`);
		}

		const { command, args } = resolveShellCommand(process.env, role);
		const shell = spawn(command, args, {
			name: "xterm-256color",
			cols,
			rows,
			cwd: process.env.HOME,
			env: spawnEnv(process.env),
		});

		// A presenter who could be handed a view token to share it with (AC-STREAM).
		// Sent as a text frame; PTY output below stays binary, unchanged.
		if (role === "presenter" && viewToken !== null) {
			socket.send(JSON.stringify({ type: "view-token", token: viewToken }));
		}

		shell.onData((data) => {
			if (capturePath) appendFileSync(capturePath, data);
			if (socket.readyState === socket.OPEN) socket.send(Buffer.from(data, "utf8"));
		});
		shell.onExit(() => socket.close());

		socket.on("message", (raw) => {
			const msg = parseClientMessage(raw.toString());
			if (msg === null) return; // ignore malformed control frames
			switch (msg.type) {
				case "input":
					shell.write(msg.data);
					break;
				case "resize":
					shell.resize(msg.cols, msg.rows);
					break;
			}
		});

		socket.on("close", () => shell.kill());
	});

	return new Promise((resolve) => {
		httpServer.listen(port, "127.0.0.1", () => {
			const address = httpServer.address() as AddressInfo;
			resolve({
				port: address.port,
				address: address.address,
				close: () =>
					new Promise<void>((done) => {
						wss.close();
						httpServer.close(() => done());
					}),
			});
		});
	});
}

function clampDim(raw: string | null, fallback: number): number {
	const n = raw ? Number.parseInt(raw, 10) : NaN;
	return Number.isFinite(n) && n > 0 && n < 1000 ? n : fallback;
}

// Auto-start when run directly (`npm start`), not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	void startServer().then((server) => {
		const { command } = resolveShellCommand(process.env, "presenter");
		const tokenNote = process.env.PTY_TOKEN ? ", token required" : "";
		const viewNote =
			process.env.PTY_VIEW_TOKEN && process.env.TMUX_SESSION
				? ", viewing enabled"
				: process.env.PTY_VIEW_TOKEN
					? ", PTY_VIEW_TOKEN set but TMUX_SESSION is not: viewing will reject every connection"
					: "";
		// oxlint-disable-next-line no-console
		console.log(
			`tmux PTY backend on ws://${server.address}:${server.port} (shell: ${command}${tokenNote}${viewNote})`,
		);
	});
}
