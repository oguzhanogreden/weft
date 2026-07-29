import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import {
  AUTO_FIT_MAX,
  AUTO_FIT_MIN,
  type CellFootprint,
  DEFAULT_GRID_SIZE,
  fitGridSize,
  GRID_SIZE_MAX,
  GRID_SIZES,
  type GridSize,
  gridSizeLabel,
  parseGridSize,
} from "./grid-size";

const FALLBACK: GridSize = { cols: 80, rows: 24 };
const cells = (size: GridSize) => size.cols * size.rows;

describe("grid size presets (AC-GRIDSIZE)", () => {
  it("opens at 160x48", () => {
    assert.deepEqual(DEFAULT_GRID_SIZE, { cols: 160, rows: 48 });
  });

  it("caps a URL-supplied size at 400x200", () => {
    assert.deepEqual(GRID_SIZE_MAX, { cols: 400, rows: 200 });
  });

  it("offers the five spec'd presets, 80x24 through 240x60", () => {
    assert.equal(GRID_SIZES.length, 5);
    assert.deepEqual(GRID_SIZES.map(gridSizeLabel), [
      "80x24",
      "120x40",
      "160x48",
      "200x50",
      "240x60",
    ]);
  });

  it("starts the ladder at the classic 80x24", () => {
    assert.deepEqual(GRID_SIZES[0], { cols: 80, rows: 24 });
  });

  it("includes the default size in the ladder", () => {
    // The opening size keys the size-list; a default outside the ladder would
    // render a grid that matches no button.
    assert.ok(GRID_SIZES.includes(DEFAULT_GRID_SIZE));
  });

  it("ascends by cell count, so the ladder reads as a cost curve", () => {
    const counts = GRID_SIZES.map(cells);
    for (let i = 1; i < counts.length; i++) {
      assert.ok(counts[i]! > counts[i - 1]!, `preset ${i} must exceed ${i - 1}`);
    }
    assert.deepEqual([counts[0], counts.at(-1)], [1920, 14400]);
  });

  it("keeps every preset inside the clamp bound", () => {
    for (const size of GRID_SIZES) {
      assert.ok(size.cols <= GRID_SIZE_MAX.cols, `${gridSizeLabel(size)} cols`);
      assert.ok(size.rows <= GRID_SIZE_MAX.rows, `${gridSizeLabel(size)} rows`);
    }
  });

  it("gives every preset a distinct label", () => {
    // The label doubles as the `List.each` reconciliation key: a collision would
    // be a duplicate-key RenderError, not merely a confusing button.
    const labels = GRID_SIZES.map(gridSizeLabel);
    assert.equal(new Set(labels).size, labels.length);
  });
});

describe("gridSizeLabel (AC-GRIDSIZE)", () => {
  it("formats as colsxrows", () => {
    assert.equal(gridSizeLabel({ cols: 80, rows: 24 }), "80x24");
    assert.equal(gridSizeLabel({ cols: 240, rows: 60 }), "240x60");
  });
});

describe("parseGridSize (AC-GRIDSIZE)", () => {
  it("reads both dimensions from the query string", () => {
    assert.deepEqual(parseGridSize("?cols=200&rows=50", FALLBACK), { cols: 200, rows: 50 });
  });

  it("accepts a search string without the leading ?", () => {
    assert.deepEqual(parseGridSize("cols=200&rows=50", FALLBACK), { cols: 200, rows: 50 });
  });

  it("falls back when the search string is empty", () => {
    assert.deepEqual(parseGridSize("", FALLBACK), FALLBACK);
  });

  it("ignores unrelated params", () => {
    assert.deepEqual(parseGridSize("?foo=bar", FALLBACK), FALLBACK);
  });

  it("falls back per dimension, so ?cols alone keeps the fallback rows", () => {
    assert.deepEqual(parseGridSize("?cols=200", FALLBACK), { cols: 200, rows: 24 });
    assert.deepEqual(parseGridSize("?rows=50", FALLBACK), { cols: 80, rows: 50 });
  });

  it("rejects non-numeric values", () => {
    assert.deepEqual(parseGridSize("?cols=abc&rows=50", FALLBACK), { cols: 80, rows: 50 });
  });

  it("rejects zero and negative values", () => {
    assert.deepEqual(parseGridSize("?cols=0&rows=-5", FALLBACK), FALLBACK);
  });

  it("rejects non-integer values", () => {
    assert.deepEqual(parseGridSize("?cols=12.5", FALLBACK), FALLBACK);
  });

  it("clamps an oversized request rather than building it", () => {
    // `?cols=99999` would otherwise lock the tab before anything renders.
    assert.deepEqual(parseGridSize("?cols=99999&rows=99999", FALLBACK), GRID_SIZE_MAX);
  });

  it("clamps each dimension independently", () => {
    assert.deepEqual(parseGridSize("?cols=99999&rows=50", FALLBACK), {
      cols: GRID_SIZE_MAX.cols,
      rows: 50,
    });
  });
});

// The measured metrics at the example's 13px font, snapped by the pixel-lock.
const CELL: CellFootprint = { cellWidth: 7.83, rowHeight: 16.25 };
const SQUARE: CellFootprint = { cellWidth: 8, rowHeight: 16 };

describe("fitGridSize (AC-RESIZE)", () => {
  it("fills the box with whole cells", () => {
    assert.deepEqual(fitGridSize({ width: 800, height: 400 }, SQUARE), { cols: 100, rows: 25 });
  });

  it("floors a partial cell rather than overflowing the box", () => {
    assert.deepEqual(fitGridSize({ width: 807, height: 407 }, SQUARE), { cols: 100, rows: 25 });
  });

  it("ignores a sub-cell change, so a resize that crosses no boundary is inert", () => {
    // The invariant that keeps a drag from re-initing the grid on every pixel.
    const a = fitGridSize({ width: 800, height: 400 }, SQUARE);
    const b = fitGridSize({ width: 803, height: 404 }, SQUARE);
    assert.deepEqual(a, b);
  });

  it("fits a portrait phone viewport", () => {
    // 390px wide less the 1.5rem body padding, and a viewport less the chrome.
    assert.deepEqual(fitGridSize({ width: 342, height: 550 }, CELL), { cols: 43, rows: 33 });
  });

  it("clamps a large display to the top preset", () => {
    // 2560x1340 fits ~326x82 (~26,700 cells), nearly double the heaviest preset.
    assert.deepEqual(fitGridSize({ width: 2560, height: 1340 }, CELL), AUTO_FIT_MAX);
  });

  it("clamps a tiny box up to the floor rather than going degenerate", () => {
    assert.deepEqual(fitGridSize({ width: 50, height: 20 }, SQUARE), AUTO_FIT_MIN);
  });

  it("falls back to the default when the cell has not been measured", () => {
    // Dividing by zero would give Infinity and clamp to the maximum, opening the
    // largest possible grid on exactly the frame where nothing is measured yet.
    assert.deepEqual(
      fitGridSize({ width: 800, height: 400 }, { cellWidth: 0, rowHeight: 16 }),
      DEFAULT_GRID_SIZE,
    );
    assert.deepEqual(
      fitGridSize({ width: 800, height: 400 }, { cellWidth: 8, rowHeight: 0 }),
      DEFAULT_GRID_SIZE,
    );
    assert.deepEqual(
      fitGridSize({ width: 800, height: 400 }, { cellWidth: -8, rowHeight: 16 }),
      DEFAULT_GRID_SIZE,
    );
  });

  it("caps at the top preset and floors at 20x5", () => {
    assert.deepEqual(AUTO_FIT_MAX, GRID_SIZES.at(-1));
    assert.deepEqual(AUTO_FIT_MIN, { cols: 20, rows: 5 });
  });

  it("never exceeds the URL clamp either", () => {
    assert.ok(AUTO_FIT_MAX.cols <= GRID_SIZE_MAX.cols);
    assert.ok(AUTO_FIT_MAX.rows <= GRID_SIZE_MAX.rows);
  });
});
