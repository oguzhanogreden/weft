import * as assert from "node:assert/strict";
import { RouterServer } from "@weftui/router/server";
import { Effect } from "effect";
import { describe, it } from "vite-plus/test";
import { App } from "../app";
import { DocsLive } from "../lib/docs-live";
import { documentShell } from "../layouts/shell";

// The app reads the real baked doc model (`virtual:weft-docs`, resolved by the
// `weftDocs` plugin registered in the root vite config) — no module mocking. The
// `Docs` service is provided through the router's render-time `context` seam as the
// build-time `DocsLive` layer. These assertions target structure and the known first
// docs, not exact prose.
const document = documentShell("/src/entry-client.ts");

/** Renders a URL through the real app, returning `{ html, status }`. */
function render(url: string): Promise<{ html: string; status: number }> {
  return Effect.runPromise(RouterServer.render(App, { document, url, context: DocsLive }));
}

describe("website routes (SSR integration)", () => {
  it("AC1: /docs/:category/:slug renders the DocPage inside the DocsShell", async () => {
    const { html, status } = await render("/docs/guides/getting-started");
    assert.equal(status, 200);
    assert.match(html, /class="docs-shell"/);
    // The markdown h1 (anchor-wrapped by rehype-autolink-headings).
    assert.match(html, /<h1[^>]*>.*Getting Started.*<\/h1>/s);
    // Sidebar groups + active link + TOC + footer all present.
    assert.match(html, /aria-current="page"/);
    assert.match(html, /On this page/);
    assert.match(html, /docs-prevnext/);
  });

  it("AC2/AC4: the active sidebar link tracks the current route", async () => {
    const { html, status } = await render("/docs/guides/routing");
    assert.equal(status, 200);
    assert.match(html, /<h1[^>]*>.*Routing.*<\/h1>/s);
    assert.match(html, /docs-nav__link is-active/);
  });

  it("AC6: the meta title reflects the doc frontmatter", async () => {
    const { html } = await render("/docs/guides/getting-started");
    assert.match(html, /<title>Getting Started · Weft<\/title>/);
    assert.match(html, /name="description"/);
  });

  it("AC2: /docs aliases to the first doc (getting-started)", async () => {
    const { html, status } = await render("/docs");
    assert.equal(status, 200);
    assert.match(html, /<h1[^>]*>.*Getting Started.*<\/h1>/s);
  });

  it("AC3: an unknown doc slug renders the 404 fallback", async () => {
    const { html, status } = await render("/docs/guides/does-not-exist");
    assert.equal(status, 404);
    assert.match(html, /404 — page not found/);
  });

  it("api AC1: /api/:pkg renders the API doc under the DocsShell", async () => {
    const { html, status } = await render("/api/core");
    assert.equal(status, 200);
    assert.match(html, /class="docs-shell"/);
    assert.match(html, /@weftui\/core/);
  });

  it("api AC2: /api aliases to the first API doc", async () => {
    const { status } = await render("/api");
    assert.equal(status, 200);
  });

  it("api AC3: an unknown package renders the 404 fallback", async () => {
    const { status } = await render("/api/nope");
    assert.equal(status, 404);
  });

  it("a doc whose section is api is not served under /docs", async () => {
    const { status } = await render("/docs/api/core");
    assert.equal(status, 404);
  });

  it("the landing route renders without the DocsShell", async () => {
    const { html, status } = await render("/");
    assert.equal(status, 200);
    assert.equal(html.includes("docs-shell"), false);
  });
});
