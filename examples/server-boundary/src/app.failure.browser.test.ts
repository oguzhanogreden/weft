/**
 * End-to-end browser test for `Boundary.server` **typed-failure replay**.
 *
 * Renders the failure variant {@link FailingApp} to hydratable HTML (as the
 * server does, attempting the server-only `load`, which fails), installs it as
 * the container markup, then `hydrate`s over it. Asserts the headline v2
 * guarantees:
 *   (a) the server emitted the `data-eui-boundary-failure` payload and the no-JS
 *       fallback (the enclosing `catchAll`), and never rendered the success
 *       `.product` subtree;
 *   (b) `hydrate` reproduces the **same** fallback without re-running `load`
 *       (the attempt count does not advance on hydration); and
 *   (c) there is no flash — the `.load-error` node is adopted in place (same DOM
 *       node before and after hydration) and the payload script is consumed.
 */

import { hydrate, type MountHandle } from "@effect-ui/dom/client";
import { renderToStringHydratable } from "@effect-ui/dom/server";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { FailingApp, getFailingLoadAttempts } from "./app";

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

describe("server-boundary example — typed-failure replay", () => {
  it("replays a typed load failure into the same fallback without re-running load", async () => {
    // 1. Server-render: `load` fails, the enclosing catchAll renders the fallback
    //    and emits the inline failure payload before it.
    const html = await Effect.runPromise(renderToStringHydratable(FailingApp()));
    container.innerHTML = html;

    // (a) Failure payload present; fallback rendered; success subtree absent.
    expect(html).toContain("data-eui-boundary-failure");
    const errorBefore = container.querySelector(".load-error");
    expect(errorBefore).not.toBeNull();
    expect(container.querySelector(".reason")?.textContent).toContain(
      "inventory service unavailable",
    );
    expect(container.querySelector(".product")).toBeNull();

    // The server attempted `load` at least once.
    const attemptsAfterServer = getFailingLoadAttempts();
    expect(attemptsAfterServer).toBeGreaterThanOrEqual(1);

    // 2. Hydrate over the server markup.
    handle = await Effect.runPromise(hydrate(FailingApp(), container));

    // (b) The client did NOT re-run `load` — replay, not retry.
    expect(getFailingLoadAttempts()).toBe(attemptsAfterServer);

    // (c) Same `.load-error` node adopted in place — no re-mount, no flash; the
    //     failure payload script is consumed.
    expect(container.querySelector(".load-error")).toBe(errorBefore);
    expect(container.querySelector(".reason")?.textContent).toContain(
      "inventory service unavailable",
    );
    expect(container.querySelector("script[data-eui-boundary-failure]")).toBeNull();
    expect(container.querySelector(".product")).toBeNull();
  });
});
