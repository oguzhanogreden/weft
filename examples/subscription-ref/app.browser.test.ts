/**
 * End-to-end browser test for the SubscriptionRef example.
 *
 * Mounts the real `App` in Chromium and asserts the headline behaviour: the
 * basic counter, backed by a `SubscriptionRef`, increments on click.
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

describe("subscription-ref example", () => {
  it("increments the basic counter on click", async () => {
    handle = await Effect.runPromise(mount(App(), container));

    const counter = () => container.querySelector(".counter");
    const plus = await vi.waitFor(() => {
      const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "+");
      expect(button).toBeDefined();
      return button!;
    });

    await vi.waitFor(() => expect(counter()?.textContent).toBe("0"));
    plus.click();
    await vi.waitFor(() => expect(counter()?.textContent).toBe("1"));
  });
});
