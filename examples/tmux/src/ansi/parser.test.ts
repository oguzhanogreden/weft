import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { getRow, rowToText } from "../grid";
import { feed, initParser, translateG0 } from "./parser";

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

// The DEC Special Graphics set, 0x5F-0x7E, as two aligned strings: source byte
// to the glyph it renders as. Ground truth is xterm's table (`0x5F` is a blank);
// `q x l k m j t u v w n` are the ones `tmux`/`ncurses` draw borders with.
const G0_SOURCE = "_`abcdefghijklmnopqrstuvwxyz{|}~";
const G0_GLYPHS = " ◆▒␉␌␍␊°±␤␋┘┐┌└┼⎺⎻─⎼⎽├┤┴┬│≤≥π≠£·";

describe("G0 DEC Special Graphics (AC-CHARSET)", () => {
  it("maps every byte of the 0x5F-0x7E table to its glyph", () => {
    assert.equal(G0_SOURCE.length, G0_GLYPHS.length); // guards a miscounted table
    for (let i = 0; i < G0_SOURCE.length; i++) {
      assert.equal(translateG0(G0_SOURCE[i]!), G0_GLYPHS[i]!, `byte ${G0_SOURCE[i]}`);
    }
  });

  it("passes 0x20-0x5E through untranslated", () => {
    for (const char of " !0159:?ABZ[]^") assert.equal(translateG0(char), char);
  });

  it("starts in ASCII, so line-drawing letters render as letters", () => {
    const p = initParser(20, 4);
    assert.equal(p.g0, "ascii");
    assert.equal(rowToText(getRow(feed(p, "lqqk").term, 0)), "lqqk");
  });

  it("ESC(0 renders a box border, ESC(B restores ASCII", () => {
    const t = run("\x1b(0lqqk\x1b(Bqq", 40, 4);
    assert.equal(rowToText(getRow(t, 0)), "┌──┐qq");
  });

  it("renders the whole table through feed", () => {
    const t = run(`\x1b(0${G0_SOURCE}`, 40, 4);
    assert.equal(rowToText(getRow(t, 0)), G0_GLYPHS);
  });

  it("leaves 0x20-0x5E alone while G0 is graphics", () => {
    const t = run("\x1b(0AZ 09 []^", 40, 4);
    assert.equal(rowToText(getRow(t, 0)), "AZ 09 []^");
  });

  it("designates across a chunk split (chunk safety)", () => {
    let p = feed(initParser(20, 4), "\x1b(0"); // designation alone in one chunk...
    p = feed(p, "qqq"); // ...glyphs in the next
    assert.equal(rowToText(getRow(p.term, 0)), "───");
  });

  it("splits ESC and ( across chunks", () => {
    let p = feed(initParser(20, 4), "\x1b");
    p = feed(p, "(0qqq");
    assert.equal(rowToText(getRow(p.term, 0)), "───");
  });

  it("ignores a G1 designation (ESC)0), which is out of scope", () => {
    const t = run("\x1b)0qqq", 20, 4);
    assert.equal(rowToText(getRow(t, 0)), "qqq");
  });

  it("consumes G2/G3 designations without printing the designator", () => {
    for (const designator of ["*", "+"]) {
      const t = run(`\x1b${designator}0qqq`, 20, 4);
      assert.equal(rowToText(getRow(t, 0)), "qqq"); // no stray `0`, no translation
    }
  });

  it("keeps the designation across a screen clear", () => {
    let p = feed(initParser(20, 4), "\x1b(0");
    p = feed(p, "\x1b[2Jqqq");
    assert.equal(p.g0, "graphics");
    assert.equal(rowToText(getRow(p.term, 0)), "───");
  });

  it("keeps the designation across an alternate-screen switch", () => {
    let p = feed(initParser(20, 4), "\x1b(0");
    p = feed(p, "\x1b[?1049hqq"); // enter alt
    assert.equal(rowToText(getRow(p.term, 0)), "──");
    p = feed(p, "\x1b[?1049l"); // leave alt
    assert.equal(p.g0, "graphics");
  });

  it("keeps the designated charset in the parser it returns", () => {
    const p = feed(initParser(20, 4), "\x1b(0");
    assert.equal(p.g0, "graphics");
    assert.equal(feed(p, "\x1b(B").g0, "ascii");
  });
});

describe("truecolor SGR (AC-TRUECOLOR)", () => {
  it("semicolon form sets a truecolor foreground (ESC[38;2;r;g;bm)", () => {
    const t = run("\x1b[38;2;255;128;0mX");
    assert.deepEqual(getRow(t, 0)[0]!.style.fg, { r: 255, g: 128, b: 0 });
  });

  it("semicolon form sets a truecolor background (ESC[48;2;r;g;bm)", () => {
    const t = run("\x1b[48;2;10;20;30mX");
    assert.deepEqual(getRow(t, 0)[0]!.style.bg, { r: 10, g: 20, b: 30 });
  });

  it("colon form with an empty colorspace-id parses (ESC[38:2::r:g:bm, tmux's output)", () => {
    const t = run("\x1b[38:2::255:128:0mX");
    assert.deepEqual(getRow(t, 0)[0]!.style.fg, { r: 255, g: 128, b: 0 });
  });

  it("colon form without a colorspace-id parses (ESC[38:2:r:g:bm)", () => {
    const t = run("\x1b[38:2:255:128:0mX");
    assert.deepEqual(getRow(t, 0)[0]!.style.fg, { r: 255, g: 128, b: 0 });
  });

  it("colon-form background parses (ESC[48:2::r:g:bm)", () => {
    const t = run("\x1b[48:2::1:2:3mX");
    assert.deepEqual(getRow(t, 0)[0]!.style.bg, { r: 1, g: 2, b: 3 });
  });

  it("colon-form 256-colour parses (ESC[38:5:nm)", () => {
    const t = run("\x1b[38:5:196mX");
    assert.equal(getRow(t, 0)[0]!.style.fg, 196);
  });

  it("a colon group never consumes following params (ESC[0;38:2::r:g:b;1m applies all three)", () => {
    const t = run("\x1b[0;38:2::255:128:0;1mX");
    const cell = getRow(t, 0)[0]!;
    assert.deepEqual(cell.style.fg, { r: 255, g: 128, b: 0 });
    assert.equal(cell.style.bold, true);
  });

  it("components missing at the params end default to 0 (ESC[38;2;255m)", () => {
    const t = run("\x1b[38;2;255mX");
    assert.deepEqual(getRow(t, 0)[0]!.style.fg, { r: 255, g: 0, b: 0 });
  });

  it("out-of-range components clamp to 0-255 (ESC[38;2;300;0;0m)", () => {
    const t = run("\x1b[38;2;300;0;0mX");
    assert.deepEqual(getRow(t, 0)[0]!.style.fg, { r: 255, g: 0, b: 0 });
  });

  it("parses a truecolor sequence split across two feeds (chunk safety)", () => {
    let p = initParser(20, 6);
    p = feed(p, "\x1b[38:2::255:");
    p = feed(p, "128:0mX");
    assert.deepEqual(getRow(p.term, 0)[0]!.style.fg, { r: 255, g: 128, b: 0 });
  });

  it("default-colour reset (ESC[39m) clears a truecolor foreground", () => {
    const t = run("\x1b[38;2;255;128;0mA\x1b[39mB");
    assert.deepEqual(getRow(t, 0)[0]!.style.fg, { r: 255, g: 128, b: 0 });
    assert.equal(getRow(t, 0)[1]!.style.fg, null);
  });

  it("a stray colon in a non-SGR sequence falls back to the param default (no NaN)", () => {
    // `ESC[:S` must scroll exactly one row, like `ESC[S`; a NaN leaking into
    // scrollUp would blank the region instead.
    const t = run("a\r\nb\x1b[:S");
    assert.equal(rowToText(getRow(t, 0)), "b");
  });

  it("semicolon 38 with an unknown kind keeps today's fallthrough behavior", () => {
    // `38;9` sets nothing and does not skip, so the `100` after it is read as
    // an SGR code (bright bg). Documented pragmatic subset, not new behavior.
    const t = run("\x1b[38;9;100mX");
    const cell = getRow(t, 0)[0]!;
    assert.equal(cell.style.fg, null);
    assert.equal(cell.style.bg, 8);
  });
});

describe("insert/delete line and character (AC-INSDEL)", () => {
  it("IL (ESC[Ps L) inserts blank lines at the cursor; rows shift down", () => {
    const t = run("a\r\nb\r\nc\x1b[2;1H\x1b[2L");
    assert.equal(rowToText(getRow(t, 0)), "a");
    assert.equal(rowToText(getRow(t, 1)), "");
    assert.equal(rowToText(getRow(t, 2)), "");
    assert.equal(rowToText(getRow(t, 3)), "b");
    assert.equal(rowToText(getRow(t, 4)), "c");
  });

  it("IL defaults to one line", () => {
    const t = run("x\x1b[H\x1b[L");
    assert.equal(rowToText(getRow(t, 0)), "");
    assert.equal(rowToText(getRow(t, 1)), "x");
  });

  it("IL is a no-op outside the scroll region and shifts inside it, keeping rows below by reference", () => {
    let p = feed(initParser(20, 6), "a\r\nb\r\nc\r\nd\x1b[1;3r");
    p = feed(p, "\x1b[4;1H\x1b[L"); // cursor below the bottom margin: no effect
    assert.equal(rowToText(getRow(p.term, 0)), "a");
    assert.equal(rowToText(getRow(p.term, 3)), "d");
    const below = p.term.lines[3];
    p = feed(p, "\x1b[2;1H\x1b[L"); // inside the region: shifts [1, 2] down
    assert.equal(rowToText(getRow(p.term, 0)), "a");
    assert.equal(rowToText(getRow(p.term, 1)), "");
    assert.equal(rowToText(getRow(p.term, 2)), "b"); // c fell off the bottom margin
    assert.equal(rowToText(getRow(p.term, 3)), "d");
    assert.equal(p.term.lines[3], below); // out-of-region row keeps its reference
  });

  it("IL clamps past the bottom margin without throwing", () => {
    const t = run("a\x1b[H\x1b[99L");
    assert.equal(rowToText(getRow(t, 0)), "");
  });

  it("DL (ESC[Ps M) deletes lines at the cursor; rows shift up, blanks fill the bottom, cursor stays", () => {
    const t = run("a\r\nb\r\nc\r\nd\x1b[2;1H\x1b[2M");
    assert.equal(rowToText(getRow(t, 0)), "a");
    assert.equal(rowToText(getRow(t, 1)), "d");
    assert.equal(rowToText(getRow(t, 2)), "");
    assert.equal(t.cursorRow, 1);
    assert.equal(t.cursorCol, 0);
  });

  it("DL respects the scroll region and keeps rows below it by reference", () => {
    let p = feed(initParser(20, 6), "a\r\nb\r\nc\r\nd\x1b[1;3r");
    const below = p.term.lines[3];
    p = feed(p, "\x1b[1;1H\x1b[M");
    assert.equal(rowToText(getRow(p.term, 0)), "b");
    assert.equal(rowToText(getRow(p.term, 1)), "c");
    assert.equal(rowToText(getRow(p.term, 2)), ""); // blank fill at the bottom margin
    assert.equal(rowToText(getRow(p.term, 3)), "d");
    assert.equal(p.term.lines[3], below);
  });

  it("ICH (ESC[Ps @) inserts blank cells; the tail shifts right and overflow is lost", () => {
    const t = run("abcde\x1b[1;2H\x1b[2@", 5);
    assert.equal(rowToText(getRow(t, 0)), "a  bc");
  });

  it("ICH fills with the current SGR style and leaves the cursor in place", () => {
    const t = run("hello\x1b[1;2H\x1b[41m\x1b[2@");
    assert.equal(rowToText(getRow(t, 0)), "h  ello");
    const row = getRow(t, 0);
    assert.equal(row[1]!.char, " ");
    assert.equal(row[1]!.style.bg, 1);
    assert.equal(row[2]!.style.bg, 1);
    assert.equal(t.cursorCol, 1);
  });

  it("DCH (ESC[Ps P) deletes cells; the tail shifts left, current-style blanks fill the row end", () => {
    const t = run("abcde\x1b[1;2H\x1b[42m\x1b[2P", 5);
    assert.equal(rowToText(getRow(t, 0)), "ade");
    const row = getRow(t, 0);
    assert.equal(row[3]!.style.bg, 2);
    assert.equal(row[4]!.style.bg, 2);
  });

  it("DCH clamps to the row width without throwing", () => {
    const t = run("abcde\x1b[1;2H\x1b[99P", 5);
    assert.equal(rowToText(getRow(t, 0)), "a");
  });

  it("an explicit zero param is a no-op for all four, unlike the default", () => {
    let p = feed(initParser(20, 6), "a\r\nb\x1b[H");
    p = feed(p, "\x1b[0L\x1b[0M\x1b[0@\x1b[0P");
    assert.equal(rowToText(getRow(p.term, 0)), "a");
    assert.equal(rowToText(getRow(p.term, 1)), "b");
    p = feed(p, "\x1b[L"); // no param: default 1 applies
    assert.equal(rowToText(getRow(p.term, 0)), "");
    assert.equal(rowToText(getRow(p.term, 1)), "a");
    assert.equal(rowToText(getRow(p.term, 2)), "b");
  });

  it("parses an insert-line sequence split across two feeds (chunk safety)", () => {
    let p = feed(initParser(20, 6), "a\r\nb\x1b[H\x1b[2");
    p = feed(p, "L");
    assert.equal(rowToText(getRow(p.term, 0)), "");
    assert.equal(rowToText(getRow(p.term, 1)), "");
    assert.equal(rowToText(getRow(p.term, 2)), "a");
    assert.equal(rowToText(getRow(p.term, 3)), "b");
  });
});
