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
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { WebSocket } from "ws";
import {
	checkToken,
	type PtyServer,
	resolveRole,
	resolveShellCommand,
	startServer,
} from "./server.ts";

let server: PtyServer;

after(async () => {
	await server?.close();
});

/** Waits for a close event, resolving to its code. */
function waitForClose(ws: WebSocket): Promise<number> {
	return new Promise((resolve) => ws.on("close", (code) => resolve(code)));
}

/** Waits for the first message, resolving to its frame type and text. */
function waitForFirstMessage(ws: WebSocket): Promise<{ isText: boolean; data: string }> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timeout waiting for a message")), 8000);
		ws.on("message", (data, isBinary) => {
			clearTimeout(timer);
			resolve({ isText: !isBinary, data: data.toString() });
		});
		ws.on("error", reject);
	});
}

/** A fresh, unlikely-to-collide tmux session name for one test. */
function testSessionName(): string {
	return `weft-test-${randomUUID()}`;
}

/** Best-effort cleanup: a test's own session may already be gone (e.g. never created). */
function killTmuxSession(name: string): void {
	try {
		execFileSync("tmux", ["kill-session", "-t", name]);
	} catch {
		// already gone; nothing to clean up
	}
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
	assert.deepEqual(resolveShellCommand({ SHELL: "/bin/bash" }, "presenter"), {
		command: "/bin/bash",
		args: [],
	});
});

test("resolveShellCommand: falls back to bash when SHELL is unset (AC-REMOTE)", () => {
	assert.deepEqual(resolveShellCommand({}, "presenter"), { command: "bash", args: [] });
});

test("resolveShellCommand: TMUX_SESSION spawns an attach-or-create tmux session (AC-REMOTE)", () => {
	assert.deepEqual(resolveShellCommand({ SHELL: "/bin/bash", TMUX_SESSION: "weft" }, "presenter"), {
		command: "tmux",
		args: ["new", "-A", "-s", "weft"],
	});
});

test("resolveShellCommand: a viewer attaches read-only to the named session (AC-STREAM)", () => {
	assert.deepEqual(resolveShellCommand({ TMUX_SESSION: "weft" }, "viewer"), {
		command: "tmux",
		args: ["attach", "-t", "weft", "-r"],
	});
});

test("resolveRole: open access when neither token is configured (AC-STREAM)", () => {
	assert.equal(resolveRole(null, null, null), "presenter");
	assert.equal(resolveRole(null, null, "anything"), "presenter");
});

test("resolveRole: the presenter token grants presenter, same as checkToken today (AC-STREAM)", () => {
	assert.equal(resolveRole("pty-token", null, "pty-token"), "presenter");
	assert.equal(resolveRole("pty-token", null, "wrong"), null);
	assert.equal(resolveRole("pty-token", null, null), null);
});

test("resolveRole: the view token grants viewer when both tokens are configured (AC-STREAM)", () => {
	assert.equal(resolveRole("pty-token", "view-token", "view-token"), "viewer");
	assert.equal(resolveRole("pty-token", "view-token", "pty-token"), "presenter");
	assert.equal(resolveRole("pty-token", "view-token", "wrong"), null);
	assert.equal(resolveRole("pty-token", "view-token", null), null);
});

test("resolveRole: an explicit view-token match wins even when presenter access is open (AC-STREAM)", () => {
	// The bug this guards against: presenterToken unset means checkToken(null, x)
	// is always true, so without checking the view token first, presenting it
	// would silently upgrade to presenter instead of granting the (more
	// restricted) role the caller explicitly asked for.
	assert.equal(resolveRole(null, "view-token", "view-token"), "viewer");
	assert.equal(resolveRole(null, "view-token", "something-else"), "presenter");
	assert.equal(resolveRole(null, "view-token", null), "presenter");
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

test("rejects a view token with close code 1008 when TMUX_SESSION is unset (AC-STREAM)", async () => {
	process.env.PTY_VIEW_TOKEN = "view-token";
	delete process.env.TMUX_SESSION;
	try {
		const s = await startServer(0);
		try {
			const ws = new WebSocket(`ws://localhost:${s.port}?cols=80&rows=24&token=view-token`);
			const code = await waitForClose(ws);
			assert.equal(code, 1008);
		} finally {
			await s.close();
		}
	} finally {
		delete process.env.PTY_VIEW_TOKEN;
	}
});

test("a presenter connection receives the view token once, as a text frame (AC-STREAM)", async () => {
	process.env.PTY_VIEW_TOKEN = "view-token";
	try {
		const s = await startServer(0);
		try {
			const ws = new WebSocket(`ws://localhost:${s.port}?cols=80&rows=24`);
			const first = await waitForFirstMessage(ws);
			assert.equal(first.isText, true);
			assert.deepEqual(JSON.parse(first.data), { type: "view-token", token: "view-token" });
			ws.close();
		} finally {
			await s.close();
		}
	} finally {
		delete process.env.PTY_VIEW_TOKEN;
	}
});

test("a presenter connection gets no extra message when PTY_VIEW_TOKEN is unset (AC-STREAM)", async () => {
	delete process.env.PTY_VIEW_TOKEN;
	const s = await startServer(0);
	try {
		const ws = new WebSocket(`ws://localhost:${s.port}?cols=80&rows=24`);
		const first = await waitForFirstMessage(ws);
		// Binary PTY output, not a JSON text control frame: nothing is inserted
		// ahead of the real byte stream when there is no token to share.
		assert.equal(first.isText, false);
		ws.close();
	} finally {
		await s.close();
	}
});

test("a view token attaches read-only: input never reaches the shell (AC-STREAM)", async () => {
	const session = testSessionName();
	execFileSync("tmux", ["new-session", "-d", "-s", session, "-x", "80", "-y", "24"]);
	process.env.PTY_VIEW_TOKEN = "view-token";
	process.env.TMUX_SESSION = session;
	try {
		const s = await startServer(0);
		try {
			const ws = new WebSocket(`ws://localhost:${s.port}?cols=80&rows=24&token=view-token`);
			await new Promise<void>((resolve, reject) => {
				ws.on("open", () => resolve());
				ws.on("close", (code) => reject(new Error(`closed unexpectedly with code ${code}`)));
				ws.on("error", reject);
			});
			ws.send(JSON.stringify({ type: "input", data: "echo VIEWER_SHOULD_NOT_RUN\r" }));
			// No response to wait for (that is the point): give tmux a moment to
			// have processed and dropped the input, then check its own state.
			await new Promise((resolve) => setTimeout(resolve, 500));
			ws.close();
			const pane = execFileSync("tmux", ["capture-pane", "-t", session, "-p"]).toString();
			assert.equal(pane.includes("VIEWER_SHOULD_NOT_RUN"), false);
		} finally {
			await s.close();
		}
	} finally {
		delete process.env.PTY_VIEW_TOKEN;
		delete process.env.TMUX_SESSION;
		killTmuxSession(session);
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
