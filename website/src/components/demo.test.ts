import * as assert from "node:assert/strict";
import { h } from "@weftui/core";
import { describe, it } from "vite-plus/test";
import { renderString } from "../__tests__/ssr";
import { Demo } from "./demo";

const tokens = [h.span({ class: "tok" }, "Counter();")];

describe("Demo (SSR)", () => {
  it("AC1: a known id renders both the live preview and the code pane", async () => {
    const html = await renderString(
      Demo({ id: "reactive-counter", tokens, lang: "ts", raw: "Counter();" }),
    );
    assert.match(html, /demo-block__preview/);
    assert.match(html, /demo-counter__value/); // the real registry component
    assert.match(html, /demo-block__code/);
    assert.match(html, /code-block/);
  });

  it("AC3: an unknown id renders a warning plus the code pane, without throwing", async () => {
    const html = await renderString(
      Demo({ id: "no-such-demo", tokens, lang: "ts", raw: "Counter();" }),
    );
    assert.match(html, /demo-block__warning/);
    assert.match(html, /Unknown demo: &quot;no-such-demo&quot;|Unknown demo: "no-such-demo"/);
    assert.match(html, /code-block/);
    assert.equal(html.includes("demo-block__preview"), false);
  });
});
