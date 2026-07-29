/**
 * Browser test for 24-bit truecolor SGR (AC-TRUECOLOR).
 *
 * Drives the whole pipeline (mock PTY bytes -> parser -> grid -> reactive DOM)
 * with truecolor sequences in both syntax forms and asserts the exact computed
 * `rgb()` on the rendered cell spans, including the inverse fg/bg swap. The
 * app mounts at its default `high` strategy, the one that renders colour.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let app: WeftApp.WeftApp | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (app) await Effect.runPromise(WeftApp.dispose(app));
  app = undefined;
  container.remove();
});

const mountWith = async (chunks: readonly string[]) => {
  const mock = makeMockTransport(chunks);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, App({ cols: 80, rows: 24 }), container));
  await vi.waitFor(() => {
    expect(container.querySelectorAll(".term-row").length).toBe(24);
  });
};

describe("truecolor SGR (AC-TRUECOLOR)", () => {
  it("renders truecolor cells with the exact rgb(), both forms, inverse swapped", async () => {
    const seq =
      "\x1b[1;1H" +
      "\x1b[38;2;255;128;0mA" + // semicolon-form foreground
      "\x1b[0m\x1b[48:2::0:64:255mB" + // colon-form background (tmux's syntax)
      "\x1b[0m\x1b[38;2;10;200;30;7mC"; // truecolor foreground + inverse
    await mountWith([seq]);

    await vi.waitFor(() => {
      const row = container.querySelectorAll(".term-row")[0]!;
      const [a, b, c] = [...row.children] as HTMLElement[];

      expect(a!.textContent).toBe("A");
      expect(getComputedStyle(a!).color).toBe("rgb(255, 128, 0)");

      expect(b!.textContent).toBe("B");
      expect(getComputedStyle(b!).backgroundColor).toBe("rgb(0, 64, 255)");

      // Inverse: the truecolor foreground paints the cell's background, and
      // the unset background falls back to the theme foreground slot.
      expect(c!.textContent).toBe("C");
      expect(getComputedStyle(c!).backgroundColor).toBe("rgb(10, 200, 30)");
    });
  });
});
