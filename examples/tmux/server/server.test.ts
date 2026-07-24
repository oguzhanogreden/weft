/**
 * Node-side integration test for the real PTY backend. Runs with `node --test`
 * (see server/package.json `test` script), NOT the workspace `vp` suites, because
 * `node-pty` is a native addon absent from the browser CI.
 *
 * Binds an ephemeral port, spawns a real shell, and asserts the input->PTY->output
 * round-trip over a real WebSocket. This is the automated coverage for the
 * "real PTY over WebSocket" path the mock transport cannot exercise.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { WebSocket } from "ws";
import { type PtyServer, startServer } from "./server.ts";

let server: PtyServer;

after(async () => {
	await server?.close();
});

test("round-trips a typed command through a real shell PTY over WebSocket", async () => {
	server = await startServer(0);
	const ws = new WebSocket(`ws://localhost:${server.port}?cols=80&rows=24`);

	const output = await new Promise<string>((resolve, reject) => {
		let buffer = "";
		const timer = setTimeout(() => reject(new Error(`timeout; got: ${JSON.stringify(buffer)}`)), 8000);
		ws.on("open", () => ws.send(JSON.stringify({ type: "input", data: "echo weft-e2e-marker\r" })));
		ws.on("message", (data) => {
			buffer += data.toString();
			if (buffer.includes("weft-e2e-marker")) {
				clearTimeout(timer);
				resolve(buffer);
			}
		});
		ws.on("error", reject);
	});

	assert.ok(output.includes("weft-e2e-marker"), "the shell should echo the typed command back over the socket");
	ws.close();
});
