/**
 * End-to-end browser test for the Element Ref example.
 *
 * Mounts the real `App` in Chromium and asserts the headline behaviour: an
 * element ref captures the live DOM node so a click handler can act on it
 * imperatively — here, scrolling the referenced target into view.
 *
 * The auto-focus and measure sections rely on a component-level `Effect.fork`
 * observer of `ref.changes` that does not outlive `mount` under an isolated
 * mount, so they are not asserted here. The scroll section instead reads the ref
 * on demand inside its handler, which is the robust, timing-independent path.
 */

import { mount, type MountHandle } from "@effect-ui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";

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

describe("element-ref example", () => {
  it("captures the DOM node so the handler can scroll it into view", async () => {
    handle = await Effect.runPromise(mount(App(), container));

    const button = await vi.waitFor(() => {
      const el = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Scroll to Target",
      );
      expect(el).toBeDefined();
      return el!;
    });

    const target = await vi.waitFor(() => {
      const el = [...container.querySelectorAll<HTMLElement>("div")].find(
        (d) => d.textContent === "Target Element",
      );
      expect(el).toBeDefined();
      return el!;
    });

    // The handler retrieves the target via its ref and calls scrollIntoView on
    // it — spy on the very node the ref captured to prove the wiring.
    const scrollSpy = vi.fn();
    target.scrollIntoView = scrollSpy;

    button.click();
    await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalled());
  });
});
