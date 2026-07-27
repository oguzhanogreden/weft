/**
 * Browser test for the read-only viewer's screen (`src/specs.md`, AC-STREAM).
 *
 * Mounts the real `ViewerApp` in Chromium with the mock transport, so it is
 * hermetic. Covers what makes a viewer's screen a *viewer's* screen: PTY
 * output still renders and the status dot still tracks connection state, but
 * none of `App`'s write-affecting or benchmark-only surface exists at all.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { makeMockTransport } from "./transport-mock";
import { ViewerApp } from "./viewer-app";

let container: HTMLElement;
let app: WeftApp.WeftApp;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await Effect.runPromise(WeftApp.dispose(app));
  container.remove();
});

const mountWith = async (chunks: readonly string[]) => {
  const mock = makeMockTransport(chunks);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, ViewerApp(), container));
  const term = await vi.waitFor(
    () => {
      const el = container.querySelector<HTMLElement>(".term");
      expect(el).not.toBeNull();
      return el!;
    },
    { timeout: 15_000 },
  );
  return { term, writes: mock.writes, mock };
};

describe("ViewerApp (AC-STREAM)", () => {
  it("renders streamed PTY output into the reactive grid, same as App", async () => {
    const { term } = await mountWith(["hello viewer\r\n$ "]);
    await vi.waitFor(() => {
      const rows = term.querySelectorAll(".term-row");
      expect(rows[0]?.textContent).toContain("hello viewer");
    });
  });

  it("shows the connection-status dot", async () => {
    await mountWith(["$ "]);
    await vi.waitFor(() => {
      expect(container.querySelector(".status")?.textContent).toBe("live");
    });
  });

  it("has no control bar: no strategy/load/size buttons, no meters, no share button", async () => {
    await mountWith(["$ "]);
    expect(container.querySelector(".controls")).toBeNull();
    expect(container.querySelector("[data-strategy]")).toBeNull();
    expect(container.querySelector("[data-load]")).toBeNull();
    expect(container.querySelector("[data-size]")).toBeNull();
    expect(container.querySelector(".meter")).toBeNull();
    expect(container.querySelector(".share")).toBeNull();
  });

  it("has no accessory row or hidden input: a viewer's keystrokes go nowhere", async () => {
    const { term, writes } = await mountWith(["$ "]);
    expect(container.querySelector(".accessory")).toBeNull();
    expect(container.querySelector(".term-input")).toBeNull();
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Give a real (mis)write a moment to land, then confirm it never did: there
    // is no keydown handler to have caught these in the first place.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(writes).toEqual([]);
  });
});
