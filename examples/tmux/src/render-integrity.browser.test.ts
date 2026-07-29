/**
 * Regression test for dropped cells at the `high` render strategy
 * (`next-steps.md` item 3, `src/specs.md` AC-RENDER).
 *
 * At `high` each cell is a `<span>` with a reactive style and a reactive char.
 * Occasionally a cell's reactive region ends up with no text node at all, so the
 * glyph is missing and the rest of the row shifts left by one advance. It hits
 * blank cells as often as written ones, which is why row-text assertions never
 * caught it: a dropped blank is invisible in `textContent`.
 *
 * The assertion is therefore structural, not textual: every cell span must own a
 * character, including the spaces.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let app: WeftApp.WeftApp;

const COLS = 80;
const ROWS = 24;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await Effect.runPromise(WeftApp.dispose(app));
  container.remove();
});

/** A full screen of content: every cell of every row written. */
const fullScreen = () => {
  let out = "\x1b[H";
  for (let r = 0; r < ROWS; r++) {
    out += `\x1b[${r + 1};1H` + String.fromCharCode(97 + (r % 26)).repeat(COLS);
  }
  return out;
};

const mountWith = async (chunks: readonly string[]) => {
  const mock = makeMockTransport(chunks);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, App({ cols: COLS, rows: ROWS }), container));
  await vi.waitFor(() => expect(container.querySelectorAll(".term-row").length).toBe(ROWS), {
    timeout: 15_000,
  });
  return mock;
};

/** Every cell span holding no text at all, as `row:col` labels. */
const emptyCells = (): string[] => {
  const dropped: string[] = [];
  container.querySelectorAll(".term-row").forEach((row, r) => {
    row.querySelectorAll("span").forEach((cell, c) => {
      if (cell.textContent === "") dropped.push(`${r}:${c}`);
    });
  });
  return dropped;
};

describe("render integrity at `high` (next-steps item 3)", () => {
  it("gives every cell of a full screen a character", async () => {
    await mountWith([fullScreen()]);
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".term-row")[0]?.textContent).toContain("a"),
    );
    expect(emptyCells()).toEqual([]);
  });

  it("gives every cell a character on a sparse write, blanks included", async () => {
    // The original repro: a handful of characters scattered over the first rows.
    // Most cells stay blank, and a dropped blank is exactly what row text hides.
    await mountWith(["\x1b[1;1HA\x1b[1;4HB\x1b[2;1HC\x1b[2;8HD\x1b[3;1HE\x1b[5;1HF\x1b[24;70HG"]);
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".term-row")[0]?.textContent).toContain("A"),
    );
    expect(emptyCells()).toEqual([]);
  });

  it("holds across repeated repaints", async () => {
    // "Repeatedly" is the acceptance bar: the defect is intermittent, so a single
    // clean mount proves little.
    const mock = await mountWith(["\x1b[H"]);
    void mock;
    for (let frame = 0; frame < 5; frame++) {
      await vi.waitFor(() => expect(container.querySelectorAll(".term-row").length).toBe(ROWS));
      expect(emptyCells()).toEqual([]);
    }
  });
});
