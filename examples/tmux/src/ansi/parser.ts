/**
 * Pure VT/ANSI parser: a byte-stream state machine that drives the grid model.
 *
 * Deliberately a pragmatic subset (documented in `src/specs.md`, AC-ANSI): SGR
 * colour/attributes, cursor movement, erase, alternate-screen, cursor
 * save/restore, scroll regions, and the G0 DEC line-drawing charset, enough to
 * render `bash`, `vim`, `htop`, and real `tmux`. Insert/delete line/char
 * (`L`/`M`/`P`/`@`), mouse reporting, and locking shifts stay out of scope.
 *
 * Scan state (mode, params, pending, charset) lives in `Parser`, not
 * `TerminalState`, so an escape sequence split across two PTY chunks still
 * parses. `feed` is pure: feed the whole stream or feed it a chunk at a time,
 * the result is identical.
 */

import {
  carriageReturn,
  DEFAULT_STYLE,
  emptyState,
  enterAlt,
  eraseChars,
  eraseInDisplay,
  eraseInLine,
  leaveAlt,
  lineFeed,
  putChar,
  scrollDown,
  scrollUp,
  setCursor,
  setScrollRegion,
  type Rgb,
  type Style,
  type TerminalState,
} from "../grid";

type Mode = "ground" | "esc" | "csi" | "osc" | "charset-g0" | "charset-other";

/** The 94-character set a slot is designated to: ASCII, or DEC Special Graphics. */
export type Charset = "ascii" | "graphics";

/** Parser = the grid plus the in-flight escape-scan state. */
export interface Parser {
  readonly term: TerminalState;
  readonly mode: Mode;
  readonly params: string;
  readonly priv: boolean;
  /** True when an OSC string is waiting for the `\` of a two-byte ST. */
  readonly oscEsc: boolean;
  /** Set designated to G0 (`ESC(0` graphics, `ESC(B` ASCII); persists across screen clears. */
  readonly g0: Charset;
}

/**
 * DEC Special Graphics: the bytes `0x5F`-`0x7E` and the glyph each renders as
 * while G0 is designated to it. `q`/`x` and the corner/tee family are what
 * `tmux` and `ncurses` draw pane borders with; `0x5F` is a blank.
 */
const DEC_SPECIAL_GRAPHICS = new Map<string, string>(
  Object.entries({
    _: " ",
    "`": "◆",
    a: "▒",
    b: "␉",
    c: "␌",
    d: "␍",
    e: "␊",
    f: "°",
    g: "±",
    h: "␤",
    i: "␋",
    j: "┘",
    k: "┐",
    l: "┌",
    m: "└",
    n: "┼",
    o: "⎺",
    p: "⎻",
    q: "─",
    r: "⎼",
    s: "⎽",
    t: "├",
    u: "┤",
    v: "┴",
    w: "┬",
    x: "│",
    y: "≤",
    z: "≥",
    "{": "π",
    "|": "≠",
    "}": "£",
    "~": "·",
  }),
);

/**
 * Translate one printable character through the DEC Special Graphics set, the
 * line-drawing glyphs `tmux`/`ncurses` draw borders with. Characters outside
 * `0x5F`-`0x7E` pass through unchanged.
 */
export function translateG0(char: string): string {
  return DEC_SPECIAL_GRAPHICS.get(char) ?? char;
}

/** A fresh parser over a cleared `cols`×`rows` grid. */
export function initParser(cols: number, rows: number): Parser {
  return {
    term: emptyState(cols, rows),
    mode: "ground",
    params: "",
    priv: false,
    oscEsc: false,
    g0: "ascii",
  };
}

const ESC = 0x1b;
const BEL = 0x07;
const BS = 0x08;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;

/**
 * Parse the CSI parameter buffer into numbers, `fallback` for empty or
 * malformed slots. The scanner admits `:` for SGR subparameter groups, so a
 * stray colon can reach any final byte; NaN must fall back rather than leak
 * into grid ops (a `scrollUp(NaN)` would blank the whole region).
 */
function nums(params: string, fallback: number): number[] {
  if (params === "") return [fallback];
  return params.split(";").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isNaN(n) ? fallback : n;
  });
}

/** Clamp a truecolor component to 0-255; a missing or malformed component reads 0. */
function channel(part: string | undefined): number {
  const n = part === undefined || part === "" ? 0 : Number.parseInt(part, 10);
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/**
 * One ISO 8613-6 colon group (`38:2::r:g:b`, `38:2:r:g:b`, `38:5:n`).
 * Self-contained: subparameters never spill into neighbouring `;`-params. The
 * colorspace-id slot is taken as present when the subparam after the kind is
 * empty or when six subparams arrive (both shapes occur in the wild).
 */
function applyColonSgr(style: Style, group: string): Style {
  const sub = group.split(":");
  const c = Number.parseInt(sub[0]!, 10);
  if (c !== 38 && c !== 48) return style;
  const kind = Number.parseInt(sub[1] ?? "", 10);
  if (kind === 5) {
    const p = sub[2];
    const idx = p === undefined ? null : p === "" ? 0 : Number.parseInt(p, 10);
    return c === 38 ? { ...style, fg: idx } : { ...style, bg: idx };
  }
  if (kind === 2) {
    const offset = sub[2] === "" || sub.length >= 6 ? 3 : 2;
    const rgb: Rgb = {
      r: channel(sub[offset]),
      g: channel(sub[offset + 1]),
      b: channel(sub[offset + 2]),
    };
    return c === 38 ? { ...style, fg: rgb } : { ...style, bg: rgb };
  }
  return style;
}

function applySgr(style: Style, params: string): Style {
  const parts = params === "" ? [""] : params.split(";");
  let next = style;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.includes(":")) {
      next = applyColonSgr(next, part);
      continue;
    }
    const c = part === "" ? 0 : Number.parseInt(part, 10);
    if (c === 0) next = DEFAULT_STYLE;
    else if (c === 1) next = { ...next, bold: true };
    else if (c === 22) next = { ...next, bold: false };
    else if (c === 3) next = { ...next, italic: true };
    else if (c === 23) next = { ...next, italic: false };
    else if (c === 4) next = { ...next, underline: true };
    else if (c === 24) next = { ...next, underline: false };
    else if (c === 7) next = { ...next, inverse: true };
    else if (c === 27) next = { ...next, inverse: false };
    else if (c >= 30 && c <= 37) next = { ...next, fg: c - 30 };
    else if (c >= 90 && c <= 97) next = { ...next, fg: c - 90 + 8 };
    else if (c === 39) next = { ...next, fg: null };
    else if (c >= 40 && c <= 47) next = { ...next, bg: c - 40 };
    else if (c >= 100 && c <= 107) next = { ...next, bg: c - 100 + 8 };
    else if (c === 49) next = { ...next, bg: null };
    else if (c === 38 || c === 48) {
      // Extended colour: `38;5;n` (256) or `38;2;r;g;b` (truecolor). Semicolon
      // form has no colorspace slot (matches xterm); missing components read 0.
      const kind = Number.parseInt(parts[i + 1] ?? "", 10);
      if (kind === 5) {
        const p = parts[i + 2];
        const idx = p === undefined ? null : p === "" ? 0 : Number.parseInt(p, 10);
        next = c === 38 ? { ...next, fg: idx } : { ...next, bg: idx };
        i += 2;
      } else if (kind === 2) {
        const rgb: Rgb = {
          r: channel(parts[i + 2]),
          g: channel(parts[i + 3]),
          b: channel(parts[i + 4]),
        };
        next = c === 38 ? { ...next, fg: rgb } : { ...next, bg: rgb };
        i += 4;
      }
    }
  }
  return next;
}

function dispatchCsi(
  term: TerminalState,
  params: string,
  priv: boolean,
  final: string,
): TerminalState {
  switch (final) {
    case "H":
    case "f": {
      const [row = 1, col = 1] = nums(params, 1);
      return setCursor(term, row - 1, col - 1);
    }
    case "A":
      return setCursor(term, term.cursorRow - nums(params, 1)[0]!, term.cursorCol);
    case "B":
      return setCursor(term, term.cursorRow + nums(params, 1)[0]!, term.cursorCol);
    case "C":
      return setCursor(term, term.cursorRow, term.cursorCol + nums(params, 1)[0]!);
    case "D":
      return setCursor(term, term.cursorRow, term.cursorCol - nums(params, 1)[0]!);
    case "G":
      return setCursor(term, term.cursorRow, nums(params, 1)[0]! - 1);
    case "d":
      return setCursor(term, nums(params, 1)[0]! - 1, term.cursorCol);
    case "J":
      return eraseInDisplay(term, nums(params, 0)[0]!);
    case "K":
      return eraseInLine(term, nums(params, 0)[0]!);
    case "m":
      return { ...term, style: applySgr(term.style, params) };
    case "s":
      return { ...term, savedCursor: { row: term.cursorRow, col: term.cursorCol } };
    case "u":
      return term.savedCursor ? setCursor(term, term.savedCursor.row, term.savedCursor.col) : term;
    case "h":
      if (priv && params === "1049") return enterAlt(term);
      return term;
    case "l":
      if (priv && params === "1049") return leaveAlt(term);
      return term;
    case "r": {
      if (priv) return term; // private `ESC[?Nr` (XTRESTORE) is not DECSTBM
      // DECSTBM: 1-based inclusive margins; empty params reset to the full screen.
      const [top = 1, bottom = term.rows] = nums(params, 1);
      return setScrollRegion(term, top - 1, bottom - 1);
    }
    case "X":
      return eraseChars(term, nums(params, 1)[0]!);
    case "S":
      return scrollUp(term, nums(params, 1)[0]!);
    case "T":
      return scrollDown(term, nums(params, 1)[0]!);
    default:
      // Unhandled (insert/delete line/char `L`/`M`/`P`/`@`, mouse modes, ...).
      return term;
  }
}

/** Feed a decoded string through the parser, returning the next parser. */
export function feed(parser: Parser, text: string): Parser {
  let term = parser.term;
  let mode = parser.mode;
  let params = parser.params;
  let priv = parser.priv;
  let oscEsc = parser.oscEsc;
  let g0 = parser.g0;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    switch (mode) {
      case "ground":
        if (code === ESC) mode = "esc";
        else if (code === CR) term = carriageReturn(term);
        else if (code === LF) term = lineFeed(term);
        else if (code === BS) term = setCursor(term, term.cursorRow, term.cursorCol - 1);
        else if (code === TAB)
          term = setCursor(term, term.cursorRow, (Math.floor(term.cursorCol / 8) + 1) * 8);
        else if (code === BEL) {
          // bell: ignore
        } else if (code >= 0x20) term = putChar(term, g0 === "graphics" ? translateG0(ch) : ch);
        break;
      case "esc":
        if (ch === "[") {
          mode = "csi";
          params = "";
          priv = false;
        } else if (ch === "]") {
          mode = "osc";
          oscEsc = false;
        } else if (ch === "(") mode = "charset-g0";
        else if (ch === ")" || ch === "*" || ch === "+") mode = "charset-other";
        else if (ch === "7") {
          term = { ...term, savedCursor: { row: term.cursorRow, col: term.cursorCol } };
          mode = "ground";
        } else if (ch === "8") {
          term = term.savedCursor
            ? setCursor(term, term.savedCursor.row, term.savedCursor.col)
            : term;
          mode = "ground";
        } else if (ch === "M") {
          term = setCursor(term, term.cursorRow - 1, term.cursorCol);
          mode = "ground";
        } else mode = "ground";
        break;
      case "csi":
        if (ch === "?" && params === "") priv = true;
        else if ((code >= 0x30 && code <= 0x39) || ch === ";" || ch === ":") params += ch;
        else if (code >= 0x40 && code <= 0x7e) {
          term = dispatchCsi(term, params, priv, ch);
          mode = "ground";
        }
        // intermediate bytes (0x20-0x2f) are collected/ignored
        break;
      case "osc":
        if (code === BEL) mode = "ground";
        else if (code === ESC) oscEsc = true;
        else if (oscEsc && ch === "\\") mode = "ground";
        else oscEsc = false;
        break;
      case "charset-g0":
        // `ESC(0` designates DEC Special Graphics; any other final (`B` ASCII,
        // `A` UK, ...) is a set we do not translate, so it means plain ASCII.
        g0 = ch === "0" ? "graphics" : "ascii";
        mode = "ground";
        break;
      case "charset-other":
        // G1/G2/G3 designations are out of scope (no locking shifts, so they can
        // never be invoked). Consume the final byte so it is not printed.
        mode = "ground";
        break;
    }
  }

  return { term, mode, params, priv, oscEsc, g0 };
}
