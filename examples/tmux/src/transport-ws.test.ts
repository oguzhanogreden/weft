import * as assert from "node:assert/strict";
import { Option } from "effect";
import { describe, it } from "vite-plus/test";
import {
  attemptAfter,
  buildConnectUrl,
  buildShareUrl,
  decodeControlMessage,
  deriveWsUrl,
  nextReconnectDecision,
} from "./transport-ws";

describe("deriveWsUrl (AC-REMOTE)", () => {
  it("maps http: to ws:", () => {
    assert.equal(
      deriveWsUrl({ protocol: "http:", host: "localhost:5173" }),
      "ws://localhost:5173/pty",
    );
  });

  it("maps https: to wss:", () => {
    assert.equal(
      deriveWsUrl({ protocol: "https:", host: "laptop.ts.net" }),
      "wss://laptop.ts.net/pty",
    );
  });

  it("preserves the host verbatim, port included", () => {
    const url = deriveWsUrl({ protocol: "http:", host: "192.168.1.5:5173" });
    assert.equal(url, "ws://192.168.1.5:5173/pty");
  });

  it("forwards a supplied token as a query param", () => {
    const url = deriveWsUrl({ protocol: "https:", host: "laptop.ts.net" }, "secret-token");
    assert.equal(url, "wss://laptop.ts.net/pty?token=secret-token");
  });

  it("omits the token param when no token is supplied", () => {
    const url = deriveWsUrl({ protocol: "http:", host: "localhost:5173" });
    assert.equal(url.includes("token"), false);
    assert.equal(url.includes("?"), false);
  });

  it("treats an empty-string token the same as no token", () => {
    const url = deriveWsUrl({ protocol: "http:", host: "localhost:5173" }, "");
    assert.equal(url, "ws://localhost:5173/pty");
  });

  it("percent-encodes a token that needs it", () => {
    const url = deriveWsUrl({ protocol: "http:", host: "localhost:5173" }, "a b&c");
    assert.equal(url, "ws://localhost:5173/pty?token=a+b%26c");
  });
});

describe("buildConnectUrl (AC-REMOTE)", () => {
  it("appends cols/rows to the derived URL, no token", () => {
    const url = buildConnectUrl({ protocol: "http:", host: "localhost:5173" }, undefined, {
      cols: 80,
      rows: 24,
    });
    assert.equal(url, "ws://localhost:5173/pty?cols=80&rows=24");
  });

  it("appends cols/rows after the token, when both are present", () => {
    const url = buildConnectUrl({ protocol: "https:", host: "laptop.ts.net" }, "tok", {
      cols: 160,
      rows: 48,
    });
    assert.equal(url, "wss://laptop.ts.net/pty?token=tok&cols=160&rows=48");
  });
});

describe("buildShareUrl (AC-STREAM)", () => {
  it("builds a page URL (not /pty) with the token and role=viewer", () => {
    const url = buildShareUrl({ protocol: "http:", host: "localhost:5173" }, "abc123");
    assert.equal(url, "http://localhost:5173/?token=abc123&role=viewer");
  });

  it("maps https: to https:, unlike deriveWsUrl's ws:/wss: mapping", () => {
    const url = buildShareUrl({ protocol: "https:", host: "laptop.ts.net" }, "abc123");
    assert.equal(url, "https://laptop.ts.net/?token=abc123&role=viewer");
  });

  it("preserves the host verbatim, port included", () => {
    const url = buildShareUrl({ protocol: "http:", host: "192.168.1.5:5173" }, "abc123");
    assert.equal(url, "http://192.168.1.5:5173/?token=abc123&role=viewer");
  });

  it("percent-encodes a token that needs it", () => {
    const url = buildShareUrl({ protocol: "http:", host: "localhost:5173" }, "a b&c");
    assert.equal(url, "http://localhost:5173/?token=a+b%26c&role=viewer");
  });

  it("role=viewer is always present, even for an empty-string token", () => {
    // Unlike deriveWsUrl, where an empty token omits the param entirely: a
    // share link with no token would be meaningless to hand out, so this is
    // a case that should not come up (buildShareUrl is only ever called with
    // a real PTY_VIEW_TOKEN value), not one worth a silent special case.
    const url = buildShareUrl({ protocol: "http:", host: "localhost:5173" }, "");
    assert.equal(url, "http://localhost:5173/?token=&role=viewer");
  });
});

describe("decodeControlMessage (AC-STREAM)", () => {
  it("decodes a valid view-token frame", () => {
    const msg = decodeControlMessage({ type: "view-token", token: "abc123" });
    assert.deepEqual(Option.getOrNull(msg), { type: "view-token", token: "abc123" });
  });

  it("rejects an unrecognized type", () => {
    assert.equal(Option.isNone(decodeControlMessage({ type: "close" })), true);
  });

  it("rejects a wrongly-typed token", () => {
    assert.equal(Option.isNone(decodeControlMessage({ type: "view-token", token: 123 })), true);
  });

  it("rejects non-object input", () => {
    assert.equal(Option.isNone(decodeControlMessage(null)), true);
    assert.equal(Option.isNone(decodeControlMessage("view-token")), true);
    assert.equal(Option.isNone(decodeControlMessage([1, 2, 3])), true);
  });
});

describe("attemptAfter (AC-REMOTE)", () => {
  it("keeps counting when the attempt never opened", () => {
    assert.equal(attemptAfter(0, false), 0);
    assert.equal(attemptAfter(5, false), 5);
  });

  it("resets a long failure streak once a connection reaches live", () => {
    // The bug this guards against: a connection that worked for an hour before
    // a blip must retry fast next time, not inherit an unrelated earlier
    // outage's attempt count and back off as if it were still failing.
    assert.equal(attemptAfter(27, true), 0);
  });

  it("is a no-op when already at 0 and the attempt opened", () => {
    assert.equal(attemptAfter(0, true), 0);
  });
});

describe("nextReconnectDecision (AC-REMOTE)", () => {
  it("is always terminal on close code 1008, at attempt 0", () => {
    assert.deepEqual(nextReconnectDecision(1008, 0), { _tag: "terminal" });
  });

  it("is always terminal on close code 1008, at a late attempt", () => {
    assert.deepEqual(nextReconnectDecision(1008, 40), { _tag: "terminal" });
  });

  it("backs off exponentially from 250ms, doubling per attempt", () => {
    const delays = [0, 1, 2, 3, 4].map((attempt) => nextReconnectDecision(1006, attempt));
    assert.deepEqual(
      delays.map((d) => d),
      [
        { _tag: "retry", delayMillis: 250 },
        { _tag: "retry", delayMillis: 500 },
        { _tag: "retry", delayMillis: 1000 },
        { _tag: "retry", delayMillis: 2000 },
        { _tag: "retry", delayMillis: 4000 },
      ],
    );
  });

  it("caps the delay at 5s", () => {
    assert.deepEqual(nextReconnectDecision(1006, 5), { _tag: "retry", delayMillis: 5000 });
    assert.deepEqual(nextReconnectDecision(1006, 6), { _tag: "retry", delayMillis: 5000 });
    assert.deepEqual(nextReconnectDecision(1006, 26), { _tag: "retry", delayMillis: 5000 });
  });

  it("gives up once cumulative backoff would exceed ~2 minutes", () => {
    // delay(n) = min(250 * 2^n, 5000); cumulative crosses 120_000ms between
    // attempt 26 (117,750ms total) and attempt 27 (122,750ms total).
    assert.deepEqual(nextReconnectDecision(1006, 26), { _tag: "retry", delayMillis: 5000 });
    assert.deepEqual(nextReconnectDecision(1006, 27), { _tag: "giveUp" });
  });

  it("never resumes retrying past the give-up attempt", () => {
    assert.deepEqual(nextReconnectDecision(1006, 100), { _tag: "giveUp" });
  });
});
