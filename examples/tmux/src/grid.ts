/**
 * Pure terminal grid model. Framework-agnostic: no Effect, no DOM, no PTY.
 *
 * The screen is `ReadonlyArray<Row>` with copy-on-write at row granularity: an
 * op that touches one row returns a new state whose other rows keep their exact
 * array reference. The reactive renderer relies on that identity to skip rows
 * that did not change, which is the whole reason a full-screen repaint stays
 * affordable (see `src/specs.md`, AC-GRID).
 */

/** SGR colour: a 0-255 palette index, or `null` for the terminal default. */
export type Color = number | null;

/** Per-cell visual attributes carried by SGR. */
export interface Style {
  readonly fg: Color;
  readonly bg: Color;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
}

/** One grid cell: a single character plus its style. */
export interface Cell {
  readonly char: string;
  readonly style: Style;
}

/** One screen row. */
export type Row = ReadonlyArray<Cell>;

/** Immutable snapshot of the terminal after applying some bytes. */
export interface TerminalState {
  readonly cols: number;
  readonly rows: number;
  readonly lines: ReadonlyArray<Row>;
  readonly cursorRow: number;
  readonly cursorCol: number;
  readonly style: Style;
  /** Top row of the scroll region (0-based, inclusive); default 0. */
  readonly scrollTop: number;
  /** Bottom row of the scroll region (0-based, inclusive); default `rows - 1`. */
  readonly scrollBottom: number;
  readonly savedCursor: { readonly row: number; readonly col: number } | null;
  /** True while the alternate screen buffer is active (vim/htop). */
  readonly alt: boolean;
  /** Main-buffer snapshot stashed while `alt` is active, restored on leave. */
  readonly saved: {
    readonly lines: ReadonlyArray<Row>;
    readonly cursorRow: number;
    readonly cursorCol: number;
  } | null;
}

/** The reset SGR style (`ESC[0m`). */
export const DEFAULT_STYLE: Style = {
  fg: null,
  bg: null,
  bold: false,
  italic: false,
  underline: false,
  inverse: false,
};

const BLANK_CELL: Cell = { char: " ", style: DEFAULT_STYLE };

/** A blank row of `cols` default cells. */
export function blankRow(cols: number): Row {
  return Array.from({ length: cols }, () => BLANK_CELL);
}

/** A fresh cleared terminal of the given size. */
export function emptyState(cols: number, rows: number): TerminalState {
  return {
    cols,
    rows,
    lines: Array.from({ length: rows }, () => blankRow(cols)),
    cursorRow: 0,
    cursorCol: 0,
    style: DEFAULT_STYLE,
    scrollTop: 0,
    scrollBottom: rows - 1,
    savedCursor: null,
    alt: false,
    saved: null,
  };
}

/** The row at `i`, or a blank row if out of range (never throws). */
export function getRow(state: TerminalState, i: number): Row {
  return state.lines[i] ?? blankRow(state.cols);
}

/** Plain text of a row, trailing blanks trimmed. Test/rendering helper. */
export function rowToText(row: Row): string {
  return row
    .map((c) => c.char)
    .join("")
    .replace(/\s+$/u, "");
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Move the cursor, clamped to the grid. */
export function setCursor(state: TerminalState, row: number, col: number): TerminalState {
  return {
    ...state,
    cursorRow: clamp(row, 0, state.rows - 1),
    cursorCol: clamp(col, 0, state.cols - 1),
  };
}

/**
 * Write one printable character at the cursor and advance. Wraps to the next
 * line at the right edge, scrolling when already on the last row.
 */
export function putChar(state: TerminalState, char: string): TerminalState {
  let next = state;
  if (next.cursorCol >= next.cols) {
    next = lineFeed({ ...next, cursorCol: 0 });
  }
  const row = next.lines[next.cursorRow] ?? blankRow(next.cols);
  const newRow = row.slice();
  newRow[next.cursorCol] = { char, style: next.style };
  const lines = next.lines.slice();
  lines[next.cursorRow] = newRow;
  return { ...next, lines, cursorCol: next.cursorCol + 1 };
}

/**
 * Scroll the scroll region up by `n` lines, filling the bottom margin with blanks.
 * Rows outside `[scrollTop, scrollBottom]` keep their exact array reference (the
 * copy-on-write identity the reactive renderer skips on).
 */
export function scrollUp(state: TerminalState, n = 1): TerminalState {
  const lines = state.lines.slice();
  for (let r = state.scrollTop; r <= state.scrollBottom; r++) {
    const src = r + n;
    lines[r] = src <= state.scrollBottom ? getRow(state, src) : blankRow(state.cols);
  }
  return { ...state, lines };
}

/** Scroll the scroll region down by `n` lines, filling the top margin with blanks. */
export function scrollDown(state: TerminalState, n = 1): TerminalState {
  const lines = state.lines.slice();
  for (let r = state.scrollBottom; r >= state.scrollTop; r--) {
    const src = r - n;
    lines[r] = src >= state.scrollTop ? getRow(state, src) : blankRow(state.cols);
  }
  return { ...state, lines };
}

/** Move down one row (LF); scroll the region when on the bottom margin. */
export function lineFeed(state: TerminalState): TerminalState {
  if (state.cursorRow === state.scrollBottom) {
    return scrollUp(state);
  }
  if (state.cursorRow >= state.rows - 1) {
    return state;
  }
  return { ...state, cursorRow: state.cursorRow + 1 };
}

/**
 * Set the scroll region to rows `[top, bottom]` (0-based, inclusive) and home the
 * cursor to origin. An invalid or empty range resets the region to the full screen.
 */
export function setScrollRegion(state: TerminalState, top: number, bottom: number): TerminalState {
  const valid = top >= 0 && bottom < state.rows && top < bottom;
  return {
    ...state,
    scrollTop: valid ? top : 0,
    scrollBottom: valid ? bottom : state.rows - 1,
    cursorRow: 0,
    cursorCol: 0,
  };
}

/** Carriage return: cursor to column 0. */
export function carriageReturn(state: TerminalState): TerminalState {
  return { ...state, cursorCol: 0 };
}

/** Erase in line. mode 0: cursor→end, 1: start→cursor, 2: whole line. */
export function eraseInLine(state: TerminalState, mode: number): TerminalState {
  const row = (state.lines[state.cursorRow] ?? blankRow(state.cols)).slice();
  const from = mode === 1 ? 0 : mode === 2 ? 0 : state.cursorCol;
  const to = mode === 0 ? state.cols - 1 : mode === 2 ? state.cols - 1 : state.cursorCol;
  for (let c = from; c <= to; c++) row[c] = { char: " ", style: state.style };
  const lines = state.lines.slice();
  lines[state.cursorRow] = row;
  return { ...state, lines };
}

/** Erase in display. mode 0: cursor→end, 1: start→cursor, 2: whole screen. */
export function eraseInDisplay(state: TerminalState, mode: number): TerminalState {
  if (mode === 2) {
    return { ...state, lines: Array.from({ length: state.rows }, () => blankRow(state.cols)) };
  }
  const lines = state.lines.slice();
  const blank = () => blankRow(state.cols);
  if (mode === 0) {
    lines[state.cursorRow] = eraseInLine(state, 0).lines[state.cursorRow]!;
    for (let r = state.cursorRow + 1; r < state.rows; r++) lines[r] = blank();
  } else if (mode === 1) {
    lines[state.cursorRow] = eraseInLine(state, 1).lines[state.cursorRow]!;
    for (let r = 0; r < state.cursorRow; r++) lines[r] = blank();
  }
  return { ...state, lines };
}

/** Erase `count` cells from the cursor (min 1), cursor unchanged, current-style fill. */
export function eraseChars(state: TerminalState, count: number): TerminalState {
  const row = (state.lines[state.cursorRow] ?? blankRow(state.cols)).slice();
  const end = Math.min(state.cols, state.cursorCol + Math.max(1, count));
  for (let c = state.cursorCol; c < end; c++) row[c] = { char: " ", style: state.style };
  const lines = state.lines.slice();
  lines[state.cursorRow] = row;
  return { ...state, lines };
}

/** Resize the grid, preserving overlapping content (clips or pads). */
export function resize(state: TerminalState, cols: number, rows: number): TerminalState {
  const lines: Row[] = Array.from({ length: rows }, (_, r) => {
    const old = state.lines[r];
    if (!old) return blankRow(cols);
    if (old.length === cols) return old;
    const row = old.slice(0, cols);
    while (row.length < cols) row.push(BLANK_CELL);
    return row;
  });
  return {
    ...state,
    cols,
    rows,
    lines,
    cursorRow: clamp(state.cursorRow, 0, rows - 1),
    cursorCol: clamp(state.cursorCol, 0, cols - 1),
    scrollTop: 0,
    scrollBottom: rows - 1,
  };
}

/** Enter the alternate screen buffer (`ESC[?1049h`), stashing the main buffer. */
export function enterAlt(state: TerminalState): TerminalState {
  if (state.alt) return state;
  return {
    ...state,
    alt: true,
    saved: { lines: state.lines, cursorRow: state.cursorRow, cursorCol: state.cursorCol },
    lines: Array.from({ length: state.rows }, () => blankRow(state.cols)),
    cursorRow: 0,
    cursorCol: 0,
  };
}

/** Leave the alternate screen buffer (`ESC[?1049l`), restoring the main buffer. */
export function leaveAlt(state: TerminalState): TerminalState {
  if (!state.alt || !state.saved) return { ...state, alt: false };
  return {
    ...state,
    alt: false,
    lines: state.saved.lines,
    cursorRow: state.saved.cursorRow,
    cursorCol: state.saved.cursorCol,
    saved: null,
  };
}
