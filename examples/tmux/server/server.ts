/**
 * PTY-over-WebSocket backend for the `examples/tmux` demo.
 *
 * One WebSocket connection == one pane == one shell PTY. Wire protocol:
 *   - client -> server: JSON text frames
 *       { type: "input", data: string }         keystrokes
 *       { type: "resize", cols: number, rows: number }
 *   - server -> client: binary frames = raw PTY output bytes
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

/**
 * The shell command for a new connection. When `TMUX_SESSION` is set, spawns
 * `tmux new -A -s <name>`, so a dropped socket's reconnect re-attaches to the
 * same session instead of starting a fresh one. Otherwise spawns `SHELL` with no
 * arguments, today's behavior (see `src/specs.md`, AC-REMOTE).
 */
export function resolveShellCommand(env: NodeJS.ProcessEnv): ShellCommand {
	const session = env.TMUX_SESSION;
	if (session) return { command: "tmux", args: ["new", "-A", "-s", session] };
	return { command: env.SHELL ?? "bash", args: [] };
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

	const httpServer = createServer();
	const wss = new WebSocketServer({ server: httpServer });

	wss.on("connection", (socket, request) => {
		const url = new URL(request.url ?? "/", "http://localhost");

		if (!checkToken(ptyToken, url.searchParams.get("token"))) {
			socket.close(1008, "unauthorized");
			return;
		}

		const cols = clampDim(url.searchParams.get("cols"), 80);
		const rows = clampDim(url.searchParams.get("rows"), 24);

		const capturePath = CAPTURE_PTY ? captureFile(CAPTURE_PTY) : null;
		if (capturePath) {
			// oxlint-disable-next-line no-console
			console.log(`capturing PTY output to ${capturePath}`);
		}

		const { command, args } = resolveShellCommand(process.env);
		const shell = spawn(command, args, {
			name: "xterm-256color",
			cols,
			rows,
			cwd: process.env.HOME,
			env: process.env as Record<string, string>,
		});

		shell.onData((data) => {
			if (capturePath) appendFileSync(capturePath, data);
			if (socket.readyState === socket.OPEN) socket.send(Buffer.from(data, "utf8"));
		});
		shell.onExit(() => socket.close());

		socket.on("message", (raw) => {
			let msg: { type?: string; data?: string; cols?: number; rows?: number };
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return; // ignore malformed control frames
			}
			if (msg.type === "input" && typeof msg.data === "string") shell.write(msg.data);
			else if (msg.type === "resize" && msg.cols && msg.rows) shell.resize(msg.cols, msg.rows);
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
		const { command } = resolveShellCommand(process.env);
		const tokenNote = process.env.PTY_TOKEN ? ", token required" : "";
		// oxlint-disable-next-line no-console
		console.log(`tmux PTY backend on ws://${server.address}:${server.port} (shell: ${command}${tokenNote})`);
	});
}
