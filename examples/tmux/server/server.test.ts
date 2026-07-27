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
import { checkToken, type PtyServer, resolveShellCommand, startServer } from "./server.ts";

let server: PtyServer;

after(async () => {
	await server?.close();
});

/** Waits for a close event, resolving to its code. */
function waitForClose(ws: WebSocket): Promise<number> {
	return new Promise((resolve) => ws.on("close", (code) => resolve(code)));
}

test("checkToken: no token configured allows any connection (AC-REMOTE)", () => {
	assert.equal(checkToken(null, null), true);
	assert.equal(checkToken(null, "anything"), true);
});

test("checkToken: a configured token must match exactly (AC-REMOTE)", () => {
	assert.equal(checkToken("secret", "secret"), true);
	assert.equal(checkToken("secret", "wrong"), false);
	assert.equal(checkToken("secret", null), false);
	// Same length, one byte off: the only case that actually exercises
	// timingSafeEqual's comparison rather than the length short-circuit above it.
	assert.equal(checkToken("secret", "secre7"), false);
});

test("checkToken: does not throw when lengths differ (AC-REMOTE)", () => {
	// The constant-time compare must handle unequal lengths without throwing,
	// or a length mismatch itself becomes an observable timing signal.
	assert.equal(checkToken("a-long-secret-token", "x"), false);
	assert.equal(checkToken("x", "a-long-secret-token"), false);
});

test("resolveShellCommand: no TMUX_SESSION spawns the plain shell (AC-REMOTE)", () => {
	assert.deepEqual(resolveShellCommand({ SHELL: "/bin/bash" }), {
		command: "/bin/bash",
		args: [],
	});
});

test("resolveShellCommand: falls back to bash when SHELL is unset (AC-REMOTE)", () => {
	assert.deepEqual(resolveShellCommand({}), { command: "bash", args: [] });
});

test("resolveShellCommand: TMUX_SESSION spawns an attach-or-create tmux session (AC-REMOTE)", () => {
	assert.deepEqual(resolveShellCommand({ SHELL: "/bin/bash", TMUX_SESSION: "weft" }), {
		command: "tmux",
		args: ["new", "-A", "-s", "weft"],
	});
});

test("binds loopback rather than every interface (AC-REMOTE)", async () => {
	const s = await startServer(0);
	try {
		assert.equal(s.address, "127.0.0.1");
	} finally {
		await s.close();
	}
});

test("rejects a missing token with close code 1008 when PTY_TOKEN is set (AC-REMOTE)", async () => {
	process.env.PTY_TOKEN = "correct-token";
	try {
		const s = await startServer(0);
		try {
			const ws = new WebSocket(`ws://localhost:${s.port}?cols=80&rows=24`);
			const code = await waitForClose(ws);
			assert.equal(code, 1008);
		} finally {
			await s.close();
		}
	} finally {
		delete process.env.PTY_TOKEN;
	}
});

test("rejects a wrong token with close code 1008 when PTY_TOKEN is set (AC-REMOTE)", async () => {
	process.env.PTY_TOKEN = "correct-token";
	try {
		const s = await startServer(0);
		try {
			const ws = new WebSocket(`ws://localhost:${s.port}?cols=80&rows=24&token=wrong-token`);
			const code = await waitForClose(ws);
			assert.equal(code, 1008);
		} finally {
			await s.close();
		}
	} finally {
		delete process.env.PTY_TOKEN;
	}
});

test("accepts a matching token when PTY_TOKEN is set (AC-REMOTE)", async () => {
	process.env.PTY_TOKEN = "correct-token";
	try {
		const s = await startServer(0);
		try {
			const ws = new WebSocket(
				`ws://localhost:${s.port}?cols=80&rows=24&token=correct-token`,
			);
			const output = await new Promise<string>((resolve, reject) => {
				let buffer = "";
				const timer = setTimeout(() => reject(new Error(`timeout; got: ${JSON.stringify(buffer)}`)), 8000);
				ws.on("open", () => ws.send(JSON.stringify({ type: "input", data: "echo weft-token-ok\r" })));
				ws.on("message", (data) => {
					buffer += data.toString();
					if (buffer.includes("weft-token-ok")) {
						clearTimeout(timer);
						resolve(buffer);
					}
				});
				ws.on("error", reject);
			});
			assert.ok(output.includes("weft-token-ok"));
			ws.close();
		} finally {
			await s.close();
		}
	} finally {
		delete process.env.PTY_TOKEN;
	}
});

test("stays open with no token when PTY_TOKEN is unset (AC-REMOTE)", async () => {
	delete process.env.PTY_TOKEN;
	const s = await startServer(0);
	try {
		const ws = new WebSocket(`ws://localhost:${s.port}?cols=80&rows=24`);
		const opened = await new Promise<boolean>((resolve, reject) => {
			ws.on("open", () => resolve(true));
			ws.on("close", (code) => reject(new Error(`closed unexpectedly with code ${code}`)));
			ws.on("error", reject);
			setTimeout(() => resolve(true), 500);
		});
		assert.equal(opened, true);
		ws.close();
	} finally {
		await s.close();
	}
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
