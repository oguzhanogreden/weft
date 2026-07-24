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

describe("scroll region + ECH (AC-SCROLLREGION)", () => {
  it("DECSTBM (ESC[1;23r) sets the region, 1-based inclusive", () => {
    const t = feed(initParser(80, 24), "\x1b[1;23r").term;
    assert.equal(t.scrollTop, 0);
    assert.equal(t.scrollBottom, 22);
  });

  it("ESC[r resets the region to the full screen", () => {
    let p = feed(initParser(80, 24), "\x1b[5;10r");
    assert.equal(p.term.scrollTop, 4); // region set...
    p = feed(p, "\x1b[r");
    assert.equal(p.term.scrollTop, 0); // ...then reset to the full screen
    assert.equal(p.term.scrollBottom, 23);
  });

  it("parses DECSTBM split across two feeds (chunk safety)", () => {
    let p = feed(initParser(20, 6), "\x1b[2;");
    p = feed(p, "5r");
    assert.equal(p.term.scrollTop, 1);
    assert.equal(p.term.scrollBottom, 4);
  });

  it("keeps a pinned status row when scrolling inside a region (tmux-attach bleed)", () => {
    // The distilled capture scenario: reserve rows 1..3, pin a status line on row 4,
    // then overflow the region so it scrolls.
    let p = feed(initParser(20, 4), "\x1b[4;1HSTATUS");
    p = feed(p, "\x1b[1;3r");
    p = feed(p, "a\r\nb\r\nc\r\nd\r\ne");
    assert.equal(rowToText(getRow(p.term, 3)), "STATUS");
    assert.equal(rowToText(getRow(p.term, 0)), "c");
  });

  it("ECH (ESC[3X) erases cells at the cursor without moving it", () => {
    const t = run("hello\x1b[1;2H\x1b[3X");
    assert.equal(
      getRow(t, 0)
        .map((cell) => cell.char)
        .join("")
        .slice(0, 5),
      "h   o",
    );
  });

  it("SU (ESC[S) scrolls the region up by one", () => {
    let p = feed(initParser(20, 4), "\x1b[1;3r");
    p = feed(p, "\x1b[1;1Hx\x1b[2;1Hy\x1b[3;1Hz");
    p = feed(p, "\x1b[S");
    assert.equal(rowToText(getRow(p.term, 0)), "y");
    assert.equal(rowToText(getRow(p.term, 1)), "z");
    assert.equal(rowToText(getRow(p.term, 2)), "");
  });

  it("ignores a private DECSTBM (ESC[?1r) rather than homing the cursor", () => {
    let p = feed(initParser(80, 24), "\x1b[5;5H"); // cursor to (4,4)
    p = feed(p, "\x1b[?1r"); // private `r` (XTRESTORE), not DECSTBM: must be a no-op here
    assert.equal(p.term.cursorRow, 4);
    assert.equal(p.term.cursorCol, 4);
  });
});
