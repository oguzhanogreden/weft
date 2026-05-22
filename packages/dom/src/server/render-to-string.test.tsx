import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { Effect, Stream } from "effect";
import type { JSXNode } from "@effect-ui/core/types";
import { renderToString } from "./render-to-string";

const run = (node: JSXNode) => Effect.runPromise(renderToString(node));

describe("renderToString - elements", () => {
  it("renders a simple element with escaped text content", async () => {
    const html = await run(<p>{"hello <b> & 'world'"}</p>);
    assert.equal(html, "<p>hello &lt;b&gt; &amp; &#x27;world&#x27;</p>");
  });

  it("renders an empty element", async () => {
    assert.equal(await run(<div />), "<div></div>");
  });

  it("renders nested elements and fragment children", async () => {
    const html = await run(
      <div>
        <span>a</span>b
      </div>,
    );
    assert.equal(html, "<div><span>a</span>b</div>");
  });
});

describe("renderToString - attributes", () => {
  it("serializes a string attribute and escapes its value", async () => {
    const html = await run(<a href={'x"&<>y'}>link</a>);
    assert.equal(html, '<a href="x&quot;&amp;&lt;&gt;y">link</a>');
  });

  it('emits truthy boolean attributes as name="" and omits falsy ones', async () => {
    assert.equal(await run(<input disabled={true} />), '<input disabled="">');
    assert.equal(await run(<input disabled={false} />), "<input>");
  });

  it("skips null and undefined attributes", async () => {
    assert.equal(await run(<div title={undefined} />), "<div></div>");
    // `null` is not in the AttributeValue type, but must still be skipped at runtime.
    assert.equal(await run({ type: "div", props: { id: null } } as JSXNode), "<div></div>");
  });

  it("skips children, ref, and event handler props", async () => {
    const html = await run(
      <button onclick={() => {}} ref={undefined} id="go">
        x
      </button>,
    );
    assert.equal(html, '<button id="go">x</button>');
  });
});

describe("renderToString - style", () => {
  it("serializes a style string", async () => {
    const html = await run(<div style="color: red" />);
    assert.equal(html, '<div style="color: red"></div>');
  });

  it("serializes a style object with camelCase keys", async () => {
    const html = await run(<div style={{ backgroundColor: "blue", fontWeight: 700 }} />);
    assert.equal(html, '<div style="background-color: blue; font-weight: 700"></div>');
  });

  it("skips null/undefined style object values", async () => {
    const html = await run(<div style={{ color: undefined, margin: "0" }} />);
    assert.equal(html, '<div style="margin: 0"></div>');
  });
});

describe("renderToString - reactive attributes", () => {
  it("resolves a Stream attribute to its last value", async () => {
    const html = await run(<div id={Stream.make("a", "b", "c")} />);
    assert.equal(html, '<div id="c"></div>');
  });

  it("resolves an Effect attribute value", async () => {
    const html = await run(<div id={Effect.succeed("eff")} />);
    assert.equal(html, '<div id="eff"></div>');
  });

  it("resolves a Stream style object property", async () => {
    const html = await run(<div style={{ color: Stream.make("red", "green") }} />);
    assert.equal(html, '<div style="color: green"></div>');
  });
});

describe("renderToString - void elements", () => {
  it("renders void elements without a closing tag", async () => {
    assert.equal(await run(<br />), "<br>");
    assert.equal(await run(<img src="/a.png" />), '<img src="/a.png">');
  });

  it("ignores children on void elements", async () => {
    // Void elements accept no children in the JSX types, so build the node directly.
    assert.equal(await run({ type: "input", props: { children: "nope" } } as JSXNode), "<input>");
  });
});
