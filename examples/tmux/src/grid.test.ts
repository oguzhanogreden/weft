import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import {
  blankRow,
  emptyState,
  eraseInLine,
  getRow,
  lineFeed,
  putChar,
  resize,
  rowToText,
  setCursor,
} from "./grid";

describe("grid model", () => {
  it("emptyState has the requested dimensions and a home cursor", () => {
    const s = emptyState(10, 4);
    assert.equal(s.cols, 10);
    assert.equal(s.rows, 4);
    assert.equal(s.lines.length, 4);
    assert.equal(getRow(s, 0).length, 10);
    assert.equal(s.cursorRow, 0);
    assert.equal(s.cursorCol, 0);
  });

  it("putChar writes at the cursor and advances the column", () => {
    let s = emptyState(5, 2);
    s = putChar(s, "h");
    s = putChar(s, "i");
    assert.equal(rowToText(getRow(s, 0)), "hi");
    assert.equal(s.cursorCol, 2);
  });

  it("copy-on-write: an untouched row keeps its exact array reference", () => {
    const s0 = emptyState(5, 3);
    const untouchedBefore = getRow(s0, 2);
    const s1 = putChar(s0, "x");
    // row 0 was rewritten...
    assert.notEqual(getRow(s1, 0), getRow(s0, 0));
    // ...but row 2 is the identical reference, so the renderer can skip it.
    assert.equal(getRow(s1, 2), untouchedBefore);
  });

  it("putChar wraps to the next line at the right edge", () => {
    let s = emptyState(2, 2);
    s = putChar(s, "a");
    s = putChar(s, "b");
    s = putChar(s, "c");
    assert.equal(rowToText(getRow(s, 0)), "ab");
    assert.equal(rowToText(getRow(s, 1)), "c");
    assert.equal(s.cursorRow, 1);
  });

  it("lineFeed on the last row scrolls the screen up", () => {
    let s = emptyState(3, 2);
    s = putChar(s, "a");
    s = setCursor(s, 1, 0);
    s = putChar(s, "b");
    s = lineFeed(s); // already on last row -> scroll
    assert.equal(rowToText(getRow(s, 0)), "b");
    assert.equal(rowToText(getRow(s, 1)), "");
  });

  it("eraseInLine mode 0 clears from the cursor to the end", () => {
    let s = emptyState(5, 1);
    for (const c of "hello") s = putChar(s, c);
    s = setCursor(s, 0, 2);
    s = eraseInLine(s, 0);
    assert.equal(rowToText(getRow(s, 0)), "he");
  });

  it("resize pads new rows with blanks and clips overflow", () => {
    let s = emptyState(3, 1);
    for (const c of "abc") s = putChar(s, c);
    s = resize(s, 2, 2);
    assert.equal(s.cols, 2);
    assert.equal(s.rows, 2);
    assert.equal(rowToText(getRow(s, 0)), "ab");
    assert.deepEqual(getRow(s, 1), blankRow(2));
  });
});
