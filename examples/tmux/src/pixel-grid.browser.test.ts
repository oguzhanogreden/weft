/**
 * Browser test for the pixel-locked grid (AC-PIXELGRID).
 *
 * Asserts the headline invariant: once the grid is mounted and the runtime
 * measurement has applied, the rendered cell advance and row height are whole
 * device pixels (`css × devicePixelRatio` rounds to an integer). The invariant
 * must hold across all three render strategies (`low`/`med`/`high`), since the
 * lock is applied to the shared `.terminal-pane` and cascades to every cell.
 *
 * The browser-test harness mounts `App` into a bare container without the
 * example's `index.html` CSS, so the layout-relevant rules are injected here.
 * Without them the pane inherits the browser default font (16px), whose metrics
 * are trivially integer and would make the assertion vacuous.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let styleEl: HTMLStyleElement;
let app: WeftApp.WeftApp;

// The layout-relevant subset of index.html: monospace font + 13px size on the
// pane (the fractional-metric source), `pre` whitespace, and the hidden probe.
const PANE_CSS = `
.terminal-pane { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
.term { white-space: pre; }
.term-row { white-space: pre; }
.term-probe { position: absolute; visibility: hidden; white-space: pre; top: 0; left: 0; }
`;

beforeEach(() => {
  styleEl = document.createElement("style");
  styleEl.textContent = PANE_CSS;
  document.head.append(styleEl);
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await Effect.runPromise(WeftApp.dispose(app));
  container.remove();
  styleEl.remove();
});

// A 24-row ruler, each row 79 columns of a repeating 0-9 digit (columns 20 and
// 60 both land inside the filled region). Fewer than 80 columns avoids any
// right-edge wrap ambiguity.
const RULER = `\x1b[H${Array(24)
  .fill(Array.from({ length: 79 }, (_unused, c) => String(c % 10)).join(""))
  .join("\r\n")}`;

/** True when `cssPx × dpr` lands on a whole device pixel (AC-PIXELGRID tolerance). */
const isWholeDevicePx = (cssPx: number): boolean => {
  const devicePx = cssPx * window.devicePixelRatio;
  return Math.abs(devicePx - Math.round(devicePx)) < 0.05;
};

/**
 * Map a 0-based column in a `.term-row`'s rendered text to `{ node, offset }`,
 * walking the row's text nodes (a `med`/`high` row is split across many nodes).
 */
const nodeAtColumn = (row: Element, column: number): { node: Text; offset: number } => {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    if (column < seen + len) return { node, offset: column - seen };
    seen += len;
    node = walker.nextNode() as Text | null;
  }
  throw new Error(`column ${column} past end of row (length ${seen})`);
};

/** Left edge (CSS px) of a single character at `column`, via a collapsed-width Range. */
const charLeft = (row: Element, column: number): number => {
  const start = nodeAtColumn(row, column);
  const end = nodeAtColumn(row, column + 1);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range.getBoundingClientRect().left;
};

/** Rendered cell advance (CSS px): span two columns to average out sub-pixel noise. */
const measureAdvance = (row: Element): number =>
  (charLeft(row, 60) - charLeft(row, 20)) / (60 - 20);

/** Mount `App` and wait until 24 rows render AND the measured lock has applied. */
const mountLocked = async () => {
  const mock = makeMockTransport([RULER]);
  app = WeftApp.make(mock.layer);
  // Pinned to 80x24: the RULER fixture is exactly 24 rows.
  await Effect.runPromise(WeftApp.mount(app, App({ cols: 80, rows: 24 }), container));
  const pane = await vi.waitFor(() => {
    const el = container.querySelector<HTMLElement>(".terminal-pane");
    expect(el).not.toBeNull();
    return el!;
  });
  // The lock is applied asynchronously by a forked observer once the probe
  // element has a layout box. `pixelLockStyle` emits a concrete positive
  // `line-height` once applied, so a positive inline `line-height` is the
  // reliable gate. Gating on it (not merely a px suffix, which `0px` satisfies)
  // is what stops the test from measuring the pre-lock fractional metrics.
  await vi.waitFor(
    () => {
      expect(container.querySelectorAll(".term-row").length).toBe(24);
      expect(Number.parseFloat(pane.style.lineHeight)).toBeGreaterThan(0);
    },
    { timeout: 4000 },
  );
  return pane;
};

/** Assert cell advance + row height are both whole device pixels for the current render. */
const assertLocked = (pane: HTMLElement) => {
  const row = pane.querySelector(".term-row");
  expect(row).not.toBeNull();

  const advance = measureAdvance(row!);
  expect(advance).toBeGreaterThan(0);
  expect(isWholeDevicePx(advance)).toBe(true);

  const rowHeight = row!.getBoundingClientRect().height;
  expect(rowHeight).toBeGreaterThan(0);
  expect(isWholeDevicePx(rowHeight)).toBe(true);
};

describe("pixel-locked grid (AC-PIXELGRID)", () => {
  it("snaps a fractional natural advance (the lock does real work)", async () => {
    // Anti-vacuity guard. If the injected CSS did not apply, the pane would use
    // the 16px browser default whose advance is integer at dpr 1; the lock's
    // `letterSpacing` would then be 0 and the whole-device-px assertions below
    // would pass without the lock doing anything. At 13px monospace the natural
    // advance is fractional (~7.83px), so the applied `letterSpacing` is a
    // nonzero sub-pixel value. Its sign is font-dependent (it can round down to a
    // negative spacing), so assert its magnitude: nonzero proves the CSS applied
    // and the lock snapped a fractional advance; sub-pixel proves it is a snap,
    // not a broken measurement.
    const pane = await mountLocked();
    const letterSpacing = Math.abs(Number.parseFloat(pane.style.letterSpacing));
    expect(letterSpacing).toBeGreaterThan(0);
    expect(letterSpacing).toBeLessThan(1);
  });

  it("locks cell advance and row height to whole device pixels (default 'high' strategy)", async () => {
    const pane = await mountLocked();
    assertLocked(pane);
  });

  it("holds the lock across all three render strategies", async () => {
    const pane = await mountLocked();
    assertLocked(pane); // high (default)

    for (const strategy of ["low", "med"] as const) {
      const button = container.querySelector<HTMLButtonElement>(`[data-strategy="${strategy}"]`);
      expect(button).not.toBeNull();
      button!.click();
      // Switching strategy rebuilds the `.term` node; wait for the new rows
      // AND their content. Structural mount and a reactive child's first
      // emission land in different scheduler ticks, so row count alone can
      // be satisfied before any row has rendered a character.
      await vi.waitFor(() => {
        expect(pane.querySelectorAll(".term-row").length).toBe(24);
        expect(pane.querySelector(".term-row")?.textContent).not.toBe("");
      });
      assertLocked(pane);
    }
  });
});
