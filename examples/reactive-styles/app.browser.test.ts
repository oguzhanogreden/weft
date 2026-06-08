/**
 * End-to-end browser test for the Reactive Styles example.
 *
 * Mounts the real `App` in Chromium and asserts the headline behaviour: an
 * individual style property driven by a stream (the animated hue) is applied to
 * the element's inline style and updates over time.
 */

import { mount, type MountHandle } from "@weftui/dom/client";
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

describe("reactive-styles example", () => {
  it("applies and updates a stream-driven inline style", async () => {
    handle = await Effect.runPromise(mount(App(), container));

    // First .demo-box is AnimatedHue, whose backgroundColor cycles every 50ms.
    const box = await vi.waitFor(() => {
      const el = container.querySelector<HTMLElement>(".demo-box");
      expect(el).not.toBeNull();
      return el!;
    });

    await vi.waitFor(() => expect(box.style.backgroundColor).not.toBe(""));
    const first = box.style.backgroundColor;
    await vi.waitFor(() => expect(box.style.backgroundColor).not.toBe(first), { timeout: 2000 });
  });
});
