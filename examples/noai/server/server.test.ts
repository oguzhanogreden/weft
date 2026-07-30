/**
 * The assembled page: both halves of the signal applied together.
 *
 * `signal.test.ts` pins the pieces. This asserts that the route actually uses
 * them, which is the part a passing unit test on `withNoaiHeader` cannot show
 * (AC-SIGNAL-HEADER / AC-SIGNAL-META).
 */

import * as assert from "node:assert/strict";
import { Effect } from "effect";
import { describe, it } from "vite-plus/test";
import { NOAI_DIRECTIVE, X_ROBOTS_TAG } from "./signal";
import { isAllowedOrigin, PORT, renderPage } from "./server";

const countRobotsMetas = (html: string): number =>
  [...html.matchAll(/<meta[^>]*name=["']robots["'][^>]*>/gi)].length;

/** Stands in for `index.html`, which already carries the tag. */
const TEMPLATE_WITH_TAG = `<!doctype html><html><head><meta name="robots" content="${NOAI_DIRECTIVE}"><title>noai</title></head><body><div id="root"></div></body></html>`;

const TEMPLATE_WITHOUT_TAG = `<!doctype html><html><head><title>noai</title></head><body><div id="root"></div></body></html>`;

describe("PORT", () => {
  it("is the port the Vite dev proxy forwards the socket to", () => {
    // `vite.config.ts` targets `ws://127.0.0.1:3300`. If the two disagree the
    // dialogue socket fails in dev only.
    assert.equal(PORT, 3300);
  });
});

describe("AC-SOCKET-ORIGIN: only this server's own origin may open the socket", () => {
  it("accepts the origin the page is served from, either spelling", () => {
    assert.equal(isAllowedOrigin(`http://127.0.0.1:${PORT}`), true);
    assert.equal(isAllowedOrigin(`http://localhost:${PORT}`), true);
  });

  it("refuses a foreign origin, which is what stops a drive-by dialogue", () => {
    // A WebSocket handshake is not subject to CORS, so any page in the same
    // browser could otherwise open this socket and drive billed model calls.
    assert.equal(isAllowedOrigin("https://evil.example"), false);
    assert.equal(isAllowedOrigin("http://localhost:5173"), false);
  });

  it("refuses an origin that merely starts with an allowed one", () => {
    // A `startsWith` check would let `http://127.0.0.1:3300.evil.example` in.
    assert.equal(isAllowedOrigin(`http://127.0.0.1:${PORT}.evil.example`), false);
    assert.equal(isAllowedOrigin(`http://127.0.0.1:${PORT}@evil.example`), false);
  });

  it("allows a request with no Origin, since non-browser clients send none", () => {
    assert.equal(isAllowedOrigin(undefined), true);
  });
});

describe("AC-SIGNAL-HEADER: the rendered response carries the header", () => {
  it("sets X-Robots-Tag on the response it hands back", async () => {
    const { headers } = await Effect.runPromise(renderPage(TEMPLATE_WITH_TAG, "scripted"));
    assert.equal(headers.get(X_ROBOTS_TAG), NOAI_DIRECTIVE);
  });
});

describe("AC-SCRIPTED: the assembled page names the transport the client should use", () => {
  const modeOf = (html: string): string | null => {
    const tag = /<meta[^>]*name=["']noai-dialogue-mode["'][^>]*>/i.exec(html);
    return tag === null ? null : (/content=["']([^"']*)["']/i.exec(tag[0])?.[1] ?? null);
  };

  it("writes the scripted mode so a keyless server does not send the client live", async () => {
    // `chosenTransport` in `src/main.ts` reads a missing tag as *live*, so losing
    // this tag makes a credential-less server tell the browser to open a real
    // socket and drive real model calls. That is the failure AC-SCRIPTED exists
    // to prevent, and it is why assembly is asserted here rather than trusted.
    const { html } = await Effect.runPromise(renderPage(TEMPLATE_WITH_TAG, "scripted"));
    assert.equal(modeOf(html), "scripted");
  });

  it("writes the live mode when the server resolved a credential", async () => {
    const { html } = await Effect.runPromise(renderPage(TEMPLATE_WITH_TAG, "live"));
    assert.equal(modeOf(html), "live");
  });

  it("writes it into a head that carries attributes", async () => {
    // The shape a literal `replace("<head>", …)` silently drops.
    const attributed = TEMPLATE_WITH_TAG.replace("<head>", '<head profile="x">');
    const { html } = await Effect.runPromise(renderPage(attributed, "scripted"));
    assert.equal(modeOf(html), "scripted");
    assert.equal(countRobotsMetas(html), 1);
  });

  it("emits both halves of the signal and the mode tag together", async () => {
    // The composition, not the pieces: each is unit-tested on its own, and the
    // defect that shipped twice lived in how they were combined.
    const { html, headers } = await Effect.runPromise(renderPage(TEMPLATE_WITHOUT_TAG, "live"));
    assert.equal(headers.get(X_ROBOTS_TAG), NOAI_DIRECTIVE);
    assert.equal(countRobotsMetas(html), 1);
    assert.equal(modeOf(html), "live");
    const head = html.slice(html.indexOf("<head"), html.indexOf("</head>"));
    assert.ok(head.includes(NOAI_DIRECTIVE), "the robots tag belongs in head");
    assert.ok(head.includes("noai-dialogue-mode"), "so does the mode tag");
  });
});

describe("AC-SIGNAL-META: the rendered document carries one meta tag", () => {
  it("yields exactly one tag from a template that already has it", async () => {
    // The production path: `index.html` ships with the tag, so the interesting
    // case is that assembly does not add a second one.
    const { html } = await Effect.runPromise(renderPage(TEMPLATE_WITH_TAG, "scripted"));
    assert.equal(countRobotsMetas(html), 1);
  });

  it("adds the tag to a template that lacks it", async () => {
    const { html } = await Effect.runPromise(renderPage(TEMPLATE_WITHOUT_TAG, "scripted"));
    assert.equal(countRobotsMetas(html), 1);
    assert.ok(html.includes(NOAI_DIRECTIVE));
  });

  it("keeps the tag inside head", async () => {
    const { html } = await Effect.runPromise(renderPage(TEMPLATE_WITHOUT_TAG, "scripted"));
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    assert.equal(countRobotsMetas(head), 1);
  });

  it("preserves the rest of the template", async () => {
    const { html } = await Effect.runPromise(renderPage(TEMPLATE_WITHOUT_TAG, "scripted"));
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("<title>noai</title>"));
  });
});
