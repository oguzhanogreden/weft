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

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node-pty";
import { WebSocketServer } from "ws";

const SHELL = process.env.SHELL ?? "bash";

/** A running backend: its bound port and a graceful shutdown. */
export interface PtyServer {
	readonly port: number;
	readonly close: () => Promise<void>;
}

/** Start the backend. Port 0 binds an ephemeral port (used by the test). */
export function startServer(port = Number(process.env.PORT ?? 8787)): Promise<PtyServer> {
	const httpServer = createServer();
	const wss = new WebSocketServer({ server: httpServer });

	wss.on("connection", (socket, request) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		const cols = clampDim(url.searchParams.get("cols"), 80);
		const rows = clampDim(url.searchParams.get("rows"), 24);

		const shell = spawn(SHELL, [], {
			name: "xterm-256color",
			cols,
			rows,
			cwd: process.env.HOME,
			env: process.env as Record<string, string>,
		});

		shell.onData((data) => {
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
		httpServer.listen(port, () => {
			resolve({
				port: (httpServer.address() as AddressInfo).port,
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
		// oxlint-disable-next-line no-console
		console.log(`tmux PTY backend on ws://localhost:${server.port} (shell: ${SHELL})`);
	});
}
