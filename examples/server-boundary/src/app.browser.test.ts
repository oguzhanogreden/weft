/**
 * End-to-end browser test for the `Boundary.server` example.
 *
 * Exercises the full universal round-trip in a real browser: render the shared
 * `App` to hydratable HTML (as the server does, running the server-only
 * `Database` `load`), inject it as the container's markup, then `hydrate` over
 * it. Asserts the three headline guarantees:
 *   (a) the product data is in the server HTML and the client never runs `load`
 *       (the server-only `Database` read count does not advance on hydration),
 *   (b) the quantity control is interactive post-hydrate, and
 *   (c) there is no hydration mismatch / flash — the `.product` node is adopted
 *       in place (same DOM node before and after hydration).
 */

import { hydrate, type MountHandle } from "@effect-ui/dom/client";
import { renderToStringHydratable } from "@effect-ui/dom/server";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App, getDatabaseReads } from "./app";

let container: HTMLElement;
let handle: MountHandle;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await Effect.runPromise(handle.unmount());
  container.remove();
});

describe("server-boundary example", () => {
  it("server-renders product data, hydrates without re-running load, stays interactive", async () => {
    // 1. Server-render to hydratable HTML and install it as the static markup.
    const html = await Effect.runPromise(renderToStringHydratable(App()));
    container.innerHTML = html;

    // (a) Product data is in the static markup before any client JS, alongside
    //     the inline replay payload.
    const heading = () => container.querySelector(".product h1");
    expect(heading()?.textContent).toContain("Effect Mug");
    expect(html).toContain('<script type="application/json">');

    // The server ran `load` (read the server-only Database) at least once.
    const readsAfterServer = getDatabaseReads();
    expect(readsAfterServer).toBeGreaterThanOrEqual(1);

    // (c) Capture the node identity so we can prove in-place adoption.
    const productBefore = container.querySelector(".product");
    expect(productBefore).not.toBeNull();

    // 2. Hydrate over the server markup.
    handle = await Effect.runPromise(hydrate(App(), container));

    // (a) The client did NOT run `load` — no further Database reads.
    expect(getDatabaseReads()).toBe(readsAfterServer);

    // (c) Same `.product` node adopted in place — no re-mount, no flash. The
    //     product data is therefore still present.
    expect(container.querySelector(".product")).toBe(productBefore);
    expect(heading()?.textContent).toContain("Effect Mug");

    // (b) The reactive quantity control is interactive post-hydrate.
    const qty = () => container.querySelector("#qty");
    expect(qty()?.textContent).toContain("1");

    const plus = [...container.querySelectorAll("button")].find((b) => b.textContent === "+");
    expect(plus).toBeDefined();

    plus!.click();
    await vi.waitFor(() => expect(qty()?.textContent).toContain("2"));
  });
});
