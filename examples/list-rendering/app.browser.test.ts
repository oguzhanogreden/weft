/**
 * End-to-end browser test for the List Rendering example.
 *
 * Mounts the real `App` in Chromium and asserts the headline behaviour: the
 * static array renders one `<li>` per item, in order.
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

describe("list-rendering example", () => {
  it("renders the static array as ordered list items", async () => {
    handle = await Effect.runPromise(mount(App(), container));

    // The mounted tree is appended a tick after `mount` resolves, so poll.
    const firstList = await vi.waitFor(() => {
      const list = container.querySelector("ul");
      expect(list).not.toBeNull();
      return list!;
    });

    const items = [...firstList.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Apple", "Banana", "Cherry", "Date", "Elderberry"]);
  });
});
