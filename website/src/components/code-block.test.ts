import * as assert from "node:assert/strict";
import { h } from "@weftui/core";
import { describe, it } from "vite-plus/test";
import { renderString } from "../__tests__/ssr";
import { CodeBlock } from "./code-block";

const tokens = [h.span({ class: "tok-keyword" }, "const"), " x = 1;"];

describe("CodeBlock (SSR)", () => {
  it("AC1: renders the highlighted tokens inside pre > code", async () => {
    const html = await renderString(CodeBlock({ tokens, raw: "const x = 1;" }));
    // Semantic root hook + <pre>/<code> tags (styling is via utilities).
    assert.match(html, /class="code-block\b/);
    assert.match(html, /<pre/);
    assert.match(html, /<code/);
    assert.match(html, /tok-keyword/);
    assert.match(html, /const/);
  });

  it("AC2: shows the language label when lang is provided", async () => {
    const html = await renderString(CodeBlock({ tokens, lang: "ts", raw: "const x = 1;" }));
    assert.match(html, /code-block-lang[^>]*>ts</);
  });

  it("AC2: hides the language label when lang is absent", async () => {
    const html = await renderString(CodeBlock({ tokens, raw: "const x = 1;" }));
    assert.equal(html.includes("code-block-lang"), false);
  });

  it("renders the copy button inert on the server with its initial 'Copy' label", async () => {
    const html = await renderString(CodeBlock({ tokens, raw: "const x = 1;" }));
    // The copy button is selected via its stable aria-label, not a BEM class.
    assert.match(html, /aria-label="Copy code"/);
    assert.match(html, /Copy</);
  });

  it("edge: an empty raw disables the copy button", async () => {
    const html = await renderString(CodeBlock({ tokens: [], raw: "" }));
    assert.match(html, /aria-label="Copy code"[^>]*disabled|disabled[^>]*aria-label="Copy code"/);
  });
});
