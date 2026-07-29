import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import {
  blankRow,
  emptyState,
  eraseChars,
  eraseInLine,
  getRow,
  lineFeed,
  putChar,
  resize,
  rowToText,
  setCursor,
  setScrollRegion,
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

describe("scroll region + ECH (AC-SCROLLREGION)", () => {
  it("setScrollRegion sets 0-based inclusive margins and homes the cursor", () => {
    const s = setScrollRegion(setCursor(emptyState(10, 6), 3, 5), 1, 4);
    assert.equal(s.scrollTop, 1);
    assert.equal(s.scrollBottom, 4);
    assert.equal(s.cursorRow, 0);
    assert.equal(s.cursorCol, 0);
  });

  it("setScrollRegion with an invalid range resets to the full screen", () => {
    const s = setScrollRegion(emptyState(10, 6), 4, 2);
    assert.equal(s.scrollTop, 0);
    assert.equal(s.scrollBottom, 5);
  });

  it("lineFeed at the bottom margin scrolls only within the region", () => {
    let s = emptyState(3, 3);
    s = setCursor(s, 2, 0);
    s = putChar(s, "S"); // row 2 = pinned status, outside the region
    s = setScrollRegion(s, 0, 1); // region rows 0..1; homes the cursor
    s = putChar(s, "a"); // row 0 = "a"
    s = setCursor(s, 1, 0);
    s = putChar(s, "b"); // row 1 = "b"
    s = setCursor(s, 1, 0);
    s = lineFeed(s); // cursor at scrollBottom -> scroll the region only
    assert.equal(rowToText(getRow(s, 0)), "b");
    assert.equal(rowToText(getRow(s, 1)), "");
    assert.equal(rowToText(getRow(s, 2)), "S"); // status row preserved
  });

  it("region scroll keeps the exact array reference of out-of-region rows", () => {
    let s = emptyState(3, 4);
    s = setCursor(s, 3, 0);
    s = putChar(s, "S");
    const statusRef = getRow(s, 3);
    s = setScrollRegion(s, 0, 2);
    s = setCursor(s, 2, 0);
    s = lineFeed(s); // scroll region [0,2]
    assert.equal(getRow(s, 3), statusRef); // untouched row keeps its reference (COW skip)
  });

  it("eraseChars blanks N cells from the cursor without moving it", () => {
    let s = emptyState(6, 1);
    for (const c of "abcdef") s = putChar(s, c);
    s = setCursor(s, 0, 1);
    s = eraseChars(s, 3);
    assert.equal(
      getRow(s, 0)
        .map((cell) => cell.char)
        .join(""),
      "a   ef",
    );
    assert.equal(s.cursorCol, 1);
  });

  it("eraseChars clamps the count to the row width", () => {
    let s = emptyState(4, 1);
    for (const c of "abcd") s = putChar(s, c);
    s = setCursor(s, 0, 2);
    s = eraseChars(s, 100);
    assert.equal(rowToText(getRow(s, 0)), "ab");
  });
});
