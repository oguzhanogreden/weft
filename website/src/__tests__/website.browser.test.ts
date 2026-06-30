/**
 * End-to-end browser test for the website rendering path.
 *
 * Exercises a DocPage in a real browser: render a doc tree (heading, prose, and a
 * `demo=reactive-counter` block) to hydratable HTML as the server does, install it as
 * the container markup, confirm the prose and the demo's server-rendered initial value
 * are present before any client JS runs, then `hydrate` over it and verify the live
 * demo becomes interactive in place. Covers the overview spec's AC7 (a DocPage render
 * plus a live-demo interaction).
 */

import { AppRpcClientTag, h } from "@weftui/core";
import { type MountHandle, hydrate } from "@weftui/dom/client";
import { renderToStringHydratable } from "@weftui/dom/server";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { HastRoot } from "../lib/markdown-loader";
import { renderHast } from "../lib/render-hast";

// The render fns require an `AppRpcClientTag` unconditionally; this page has no
// `Boundary.rpc`, so discharge it with a no-op that dies if ever called.
const NoRpc = Layer.succeed(AppRpcClientTag, {
  call: () => Effect.die(new Error("no rpc in this test")),
});

/** A doc tree: a heading, a paragraph, and a `demo=reactive-counter` code block. */
const tree: HastRoot = {
  type: "root",
  children: [
    {
      type: "element",
      tagName: "h1",
      properties: {},
      children: [{ type: "text", value: "Reactive Counter" }],
    },
    {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value: "Click to increment." }],
    },
    {
      type: "element",
      tagName: "pre",
      properties: { dataLang: "ts", dataRaw: "Counter();", dataDemo: "reactive-counter" },
      children: [
        {
          type: "element",
          tagName: "code",
          properties: {},
          children: [{ type: "text", value: "Counter();" }],
        },
      ],
    },
  ],
};

/** The DocPage node (deterministic, so server and client trees align for hydration). */
const DocPage = () => h.article({ class: "docs-content" }, renderHast(tree));

let container: HTMLElement;
let handle: MountHandle | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (handle) await Effect.runPromise(handle.unmount());
  handle = undefined;
  container.remove();
});

describe("website DocPage + live demo (browser)", () => {
  it("renders prose and a live demo on the server, then hydrates to interactivity", async () => {
    // 1. Server-render to hydratable HTML and install it as the static markup.
    const html = await Effect.runPromise(
      Effect.provide(renderToStringHydratable(DocPage()), NoRpc),
    );
    container.innerHTML = html;

    // 2. DocPage render: prose is present before any client JS runs.
    expect(container.querySelector("h1")?.textContent).toContain("Reactive Counter");
    expect(container.textContent).toContain("Click to increment.");

    // 3. The live demo's preview is server-rendered at its initial value.
    const value = () => container.querySelector(".demo-counter__value");
    expect(value()?.textContent).toContain("0");

    // 4. Hydrate over the server markup; the demo becomes interactive in place.
    handle = await Effect.runPromise(hydrate(DocPage(), container));
    const increment = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Increment",
    );
    expect(increment).toBeDefined();

    increment!.click();
    await vi.waitFor(() => expect(value()?.textContent).toContain("1"));
  });
});
