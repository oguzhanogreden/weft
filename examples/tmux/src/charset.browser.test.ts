/**
 * Browser test for the DEC line-drawing charset (AC-CHARSET).
 *
 * Drives the whole pipeline (mock PTY bytes -> parser -> grid -> reactive DOM)
 * with what `tmux` actually emits for pane borders: `ESC(0`, the box-drawing
 * letters, then `ESC(B`. The glyphs must reach the DOM as box characters.
 *
 * The second test guards the AC-PIXELGRID assumption the first one leans on.
 * Box-drawing glyphs are East-Asian-Ambiguous width, so a font stack that
 * resolves them from a different face than the ASCII digits would render border
 * rows at a different advance and break column alignment. It measures the glyphs
 * directly rather than through the grid, so it stays a font-metric assertion.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { makeMockTransport } from "./transport-mock";

/** The example's monospace stack (index.html), the one whose coverage matters here. */
const FONT_STACK = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

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
  await Effect.runPromise(WeftApp.mount(app, App(), container));
  await vi.waitFor(() => {
    expect(container.querySelectorAll(".term-row").length).toBe(24);
  });
};

/** Rendered width of `text` at the example's terminal font, in CSS pixels. */
const measureText = (text: string): number => {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${FONT_STACK};font-size:13px`;
  probe.textContent = text;
  container.append(probe);
  const { width } = probe.getBoundingClientRect();
  probe.remove();
  return width;
};

describe("DEC line-drawing charset (AC-CHARSET)", () => {
  it("renders ESC(0 line-drawing bytes as box glyphs, and ESC(B restores ASCII", async () => {
    // A pane border the way ncurses draws one, then the same letters after the
    // charset is reset: identical bytes, two different renderings.
    const box = "\x1b[1;1H\x1b(0lqqk\x1b[2;1Hx\x1b[2;4Hx\x1b[3;1Hmqqj\x1b(B\x1b[5;1Hlqqk";
    await mountWith([box]);

    await vi.waitFor(() => {
      const rows = [...container.querySelectorAll(".term-row")].map((r) => r.textContent ?? "");
      expect(rows[0]).toContain("┌─");
      expect(rows[0]).toContain("─┐");
      expect(rows[1]).toContain("│");
      expect(rows[2]).toContain("└─");
      expect(rows[2]).toContain("─┘");
      expect(rows[4]).toContain("lqqk"); // ESC(B put G0 back to ASCII
      // The designation itself never reaches the grid.
      expect(rows.join("")).not.toContain("(0");
    });
  });

  it("resolves box-drawing glyphs at the ASCII advance (AC-PIXELGRID)", () => {
    // Every glyph `tmux` draws a pane border with, against the same count of
    // ASCII cells. A fallback face for any of them would widen the run and pull
    // border rows out of column with the rows around them.
    const border = "─│┌┐└┘├┤┬┴┼";
    const ascii = "0".repeat(border.length);
    const asciiWidth = measureText(ascii);
    expect(asciiWidth).toBeGreaterThan(0);
    const drift = Math.abs(measureText(border) - asciiWidth) / border.length;
    expect(drift).toBeLessThan(0.05); // per-cell, in CSS pixels
  });
});
