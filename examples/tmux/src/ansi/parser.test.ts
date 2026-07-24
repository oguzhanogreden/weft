import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { getRow, rowToText } from "../grid";
import { feed, initParser } from "./parser";

const run = (text: string, cols = 20, rows = 6) => feed(initParser(cols, rows), text).term;

describe("ansi parser", () => {
  it("writes plain text to the first row", () => {
    const t = run("hello");
    assert.equal(rowToText(getRow(t, 0)), "hello");
  });

  it("CR + LF move to the start of the next line", () => {
    const t = run("ab\r\ncd");
    assert.equal(rowToText(getRow(t, 0)), "ab");
    assert.equal(rowToText(getRow(t, 1)), "cd");
  });

  it("CUP (ESC[row;colH) positions the cursor, 1-based", () => {
    const t = run("\x1b[2;3Hx");
    assert.equal(t.cursorRow, 1); // wrote at row 2 col 3, then advanced
    assert.equal(rowToText(getRow(t, 1)), "  x");
  });

  it("SGR sets and resets style attributes", () => {
    const p = feed(initParser(10, 2), "\x1b[1;31mA\x1b[0mB").term;
    const row = getRow(p, 0);
    assert.equal(row[0]!.style.bold, true);
    assert.equal(row[0]!.style.fg, 1); // red
    assert.equal(row[1]!.style.bold, false);
    assert.equal(row[1]!.style.fg, null);
  });

  it("256-colour SGR (ESC[38;5;Nm) sets a palette index", () => {
    const t = run("\x1b[38;5;208mQ");
    assert.equal(getRow(t, 0)[0]!.style.fg, 208);
  });

  it("ED (ESC[2J) clears the whole screen", () => {
    const t = run("abc\r\ndef\x1b[2J");
    assert.equal(rowToText(getRow(t, 0)), "");
    assert.equal(rowToText(getRow(t, 1)), "");
  });

  it("alternate screen preserves and restores the main buffer", () => {
    let p = feed(initParser(10, 3), "main");
    p = feed(p, "\x1b[?1049h"); // enter alt: screen cleared
    assert.equal(rowToText(getRow(p.term, 0)), "");
    p = feed(p, "alt");
    assert.equal(rowToText(getRow(p.term, 0)), "alt");
    p = feed(p, "\x1b[?1049l"); // leave alt: main restored
    assert.equal(rowToText(getRow(p.term, 0)), "main");
  });

  it("parses an escape sequence split across two feeds (chunk safety)", () => {
    let p = feed(initParser(10, 2), "\x1b[1;3"); // sequence cut mid-params
    p = feed(p, "1mZ"); // ...continued in the next chunk
    const cell = getRow(p.term, 0)[0]!;
    assert.equal(cell.char, "Z");
    assert.equal(cell.style.bold, true);
    assert.equal(cell.style.fg, 1);
  });

  it("consumes an OSC title string without emitting it to the grid", () => {
    const t = run("\x1b]0;my title\x07visible");
    assert.equal(rowToText(getRow(t, 0)), "visible");
  });
});
