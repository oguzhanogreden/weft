/**
 * WebSocket URL derivation. Pure, so it is pinned here rather than in the
 * browser test.
 *
 * The live transport itself is not unit-tested: it needs a real socket, and the
 * accumulation it performs is already covered in `transport.test.ts` through the
 * shared `Transcript`.
 */

import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { DIALOGUE_PATH, deriveWsUrl } from "./transport-live";

describe("DIALOGUE_PATH", () => {
  it("is the path the Vite dev proxy forwards", () => {
    // `vite.config.ts` proxies this exact key to the server. If the two ever
    // disagree the socket 404s in dev only, which is the kind of break that
    // survives every test that mounts against the scripted transport.
    assert.equal(DIALOGUE_PATH, "/dialogue");
  });
});

describe("deriveWsUrl (AC-TURNS: one socket, no dev/prod branch)", () => {
  it("maps http: to ws:", () => {
    assert.equal(
      deriveWsUrl({ protocol: "http:", host: "localhost:5173" }),
      "ws://localhost:5173/dialogue",
    );
  });

  it("maps https: to wss:", () => {
    assert.equal(
      deriveWsUrl({ protocol: "https:", host: "noai.example" }),
      "wss://noai.example/dialogue",
    );
  });

  it("preserves the host verbatim, port included", () => {
    assert.equal(
      deriveWsUrl({ protocol: "http:", host: "192.168.1.5:5173" }),
      "ws://192.168.1.5:5173/dialogue",
    );
  });

  it("appends no query string: this socket carries no credential", () => {
    // Unlike `examples/tmux`, which forwards an access token. Nothing here is
    // authenticated from the client, because the credential never leaves the
    // server (AC-NO-KEY-IN-CLIENT).
    const url = deriveWsUrl({ protocol: "http:", host: "localhost:5173" });
    assert.equal(url.includes("?"), false);
  });

  it("ends with DIALOGUE_PATH, so the two cannot drift apart", () => {
    assert.ok(deriveWsUrl({ protocol: "http:", host: "localhost:5173" }).endsWith(DIALOGUE_PATH));
  });
});
