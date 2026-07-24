/**
 * End-to-end browser test for the tmux example.
 *
 * Mounts the real `App` in Chromium with the mock transport (`PtyTransportMock`),
 * so it is hermetic (no `node-pty` backend). Asserts the two headline behaviours
 * of the single-terminal milestone: streamed PTY output renders into the reactive
 * grid, and keystrokes flow back out through `session.write`.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { makeMockTransport } from "./transport-mock";

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
  await Effect.runPromise(WeftApp.mount(app, App(), container));
  const term = await vi.waitFor(() => {
    const el = container.querySelector<HTMLElement>(".term");
    expect(el).not.toBeNull();
    return el!;
  });
  return { term, writes: mock.writes };
};

describe("tmux example", () => {
  it("renders streamed PTY output into the reactive grid", async () => {
    const { term } = await mountWith(["hello world\r\n$ "]);
    await vi.waitFor(() => {
      const rows = term.querySelectorAll(".term-row");
      expect(rows[0]?.textContent).toContain("hello world");
      expect(rows[1]?.textContent).toContain("$");
    });
  });

  it("sends keystrokes to the PTY via session.write", async () => {
    const { term, writes } = await mountWith(["$ "]);
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(writes.join("")).toBe("ls\r"));
  });
});
