import * as assert from "node:assert/strict";
import { h } from "@weftui/core";
import { describe, it } from "vite-plus/test";
import { renderString } from "../__tests__/ssr";
import {
  type HastElement,
  type HastNode,
  type HastProperties,
  type HastRoot,
  type HastText,
  parseDoc,
} from "./markdown-loader";
import { renderHast } from "./render-hast";

const text = (value: string): HastText => ({ type: "text", value });
const el = (
  tagName: string,
  properties: HastProperties,
  children: readonly HastNode[],
): HastElement => ({ type: "element", tagName, properties, children });
const root = (children: readonly HastNode[]): HastRoot => ({ type: "root", children });

/** Renders a hast node to its SSR HTML string (wrapped so multiple roots render). */
function html(node: HastNode): Promise<string> {
  return renderString(h.div({}, renderHast(node)));
}

describe("renderHast", () => {
  it("AC1: renders paragraphs, lists, links, and emphasis to matching markup", async () => {
    const out = await html(
      root([
        el("p", {}, [text("Hello "), el("strong", {}, [text("world")])]),
        el("ul", {}, [el("li", {}, [text("one")]), el("li", {}, [text("two")])]),
        el("a", { href: "/docs/guides/routing" }, [text("link")]),
      ]),
    );
    assert.match(out, /<p>Hello <strong>world<\/strong><\/p>/);
    assert.match(out, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(out, /<a href="\/docs\/guides\/routing">link<\/a>/);
  });

  it("AC2: a className array becomes a single space-joined class string", async () => {
    const out = await html(el("div", { className: ["a", "b", "c"] }, [text("x")]));
    assert.match(out, /class="a b c"/);
  });

  it("AC3: anchor href and image src/alt are preserved", async () => {
    const out = await html(
      root([
        el("a", { href: "https://effect.website" }, [text("Effect")]),
        el("img", { src: "/logo.svg", alt: "Weft logo" }, []),
      ]),
    );
    assert.match(out, /href="https:\/\/effect.website"/);
    assert.match(out, /src="\/logo.svg"/);
    assert.match(out, /alt="Weft logo"/);
  });

  it("AC4: a code block renders via CodeBlock with the Shiki token markup intact", async () => {
    const pre = el("pre", { dataLang: "ts", dataRaw: "const x = 1;" }, [
      el("code", {}, [el("span", { style: "color:#79c0ff" }, [text("const")]), text(" x = 1;")]),
    ]);
    const out = await html(pre);
    assert.match(out, /code-block/);
    assert.match(out, /code-block__lang[^>]*>ts</);
    assert.match(out, /color:#79c0ff/); // shiki token color survives prop mapping
    assert.match(out, /const/);
  });

  it("AC5: a demo=<id> code block renders the live Demo component", async () => {
    const pre = el("pre", { dataLang: "ts", dataRaw: "Counter();", dataDemo: "reactive-counter" }, [
      el("code", {}, [text("Counter();")]),
    ]);
    const out = await html(pre);
    assert.match(out, /demo-block/);
    assert.match(out, /demo-counter__value/); // the real registry preview
    assert.match(out, /code-block/); // and the code pane
  });

  it("AC6: disallowed tags are skipped without throwing; their text children still render", async () => {
    const out = await html(root([el("iframe", {}, [text("inner")]), el("p", {}, [text("safe")])]));
    assert.equal(out.includes("<iframe"), false);
    assert.match(out, /inner/);
    assert.match(out, /<p>safe<\/p>/);
  });

  it("AC8: an empty tree yields an empty Renderable[]", () => {
    assert.deepEqual(renderHast(root([])), []);
  });

  it("edge: deeply nested inline formatting renders correctly", async () => {
    const out = await html(
      el("strong", {}, [el("a", { href: "/x" }, [el("em", {}, [text("deep")])])]),
    );
    assert.match(out, /<strong><a href="\/x"><em>deep<\/em><\/a><\/strong>/);
  });

  it("edge: a table renders its rows and cells", async () => {
    const out = await html(
      el("table", {}, [
        el("thead", {}, [el("tr", {}, [el("th", {}, [text("A")])])]),
        el("tbody", {}, [el("tr", {}, [el("td", {}, [text("1")])])]),
      ]),
    );
    assert.match(out, /<table><thead><tr><th>A<\/th><\/tr><\/thead>/);
    assert.match(out, /<tbody><tr><td>1<\/td><\/tr><\/tbody><\/table>/);
  });

  // Full pipeline: real markdown → parseDoc (remark/rehype/Shiki) → renderHast → SSR.
  it("integration: parsed markdown renders headings, links, and real Shiki code", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n## Hello\n\nA [link](./routing.md) and \`inline\`.\n\n\`\`\`ts\nconst x: number = 1;\n\`\`\`\n`,
      "/repo/docs/guides/getting-started.md",
      "/repo/docs",
    );
    const out = await renderString(h.article({}, renderHast(doc.tree)));
    assert.match(out, /<h2 id="hello">/);
    assert.match(out, /href="\/docs\/guides\/routing"/);
    assert.match(out, /code-block/);
    assert.match(out, /color:#/); // real Shiki token colors
    assert.match(out, /const/);
  });
});
