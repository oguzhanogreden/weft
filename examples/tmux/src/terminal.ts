/**
 * Terminal rendering + input for the tmux example.
 *
 * State is one `SubscriptionRef<Row>` per screen row (`makeGrid`). `pump` feeds a
 * byte stream through the pure parser in a scope-bound fiber and `set`s only the
 * rows whose copy-on-write reference changed, reporting the count so a meter can
 * track update throughput. `renderRows` renders those refs per strategy.
 *
 * The strategy is how many reactive nodes each row is split into: `low` = 1 text
 * node (whole line), `med` = a handful of text segments, `high` = one coloured
 * `<span>` per cell (reactive style + char). That node/subscription count is the
 * variable the perf meter measures; `high` also carries SGR colour (see
 * `src/specs.md`, AC-RENDER).
 */

import { h } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, type Scope, Stream, SubscriptionRef } from "effect";
import { feed, initParser } from "./ansi/parser";
import { blankRow, DEFAULT_STYLE, type Row, type Style } from "./grid";
import { segmentsFor, type Strategy } from "./perf";

export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

/** One `SubscriptionRef<Row>` per screen row, all initially blank. */
export function makeGrid(
  cols: number,
  rows: number,
): Effect.Effect<SubscriptionRef.SubscriptionRef<Row>[]> {
  return Effect.all(Array.from({ length: rows }, () => SubscriptionRef.make<Row>(blankRow(cols))));
}

/**
 * Fork a scoped fiber that pumps `input` through the parser into `rowRefs`,
 * updating only changed rows and reporting how many changed per chunk.
 */
export function pump(
  rowRefs: ReadonlyArray<SubscriptionRef.SubscriptionRef<Row>>,
  cols: number,
  rows: number,
  input: Stream.Stream<Uint8Array>,
  onRowsChanged: (n: number) => void,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    let parser = initParser(cols, rows);
    let previous = parser.term.lines;
    const decoder = new TextDecoder();

    const onChunk = (bytes: Uint8Array) =>
      Effect.gen(function* () {
        if (bytes.length === 0) return;
        parser = feed(parser, decoder.decode(bytes, { stream: true }));
        const lines = parser.term.lines;
        let changed = 0;
        for (let i = 0; i < rows; i++) {
          if (lines[i] !== previous[i]) {
            const ref = rowRefs[i];
            if (ref) {
              yield* SubscriptionRef.set(ref, lines[i] ?? blankRow(cols));
              changed++;
            }
          }
        }
        previous = lines;
        if (changed > 0) onRowsChanged(changed);
      });

    yield* Effect.forkScoped(Stream.runForEach(input, onChunk));
  });
}

/** Text of the `s`-th of `segments` slices of a row (blanks preserved). */
function segmentText(row: Row, s: number, segments: number): string {
  const size = Math.ceil(row.length / segments);
  const start = s * size;
  const end = Math.min(row.length, start + size);
  let out = "";
  for (let i = start; i < end; i++) out += row[i]?.char ?? " ";
  return out;
}

// Base 16 ANSI colours (matching the dark theme's palette family).
const ANSI_16 = [
  "#3b4048",
  "#f28779",
  "#bae67e",
  "#ffd580",
  "#73d0ff",
  "#d4bfff",
  "#95e6cb",
  "#c7c7c7",
  "#707a8c",
  "#f28779",
  "#bae67e",
  "#ffd580",
  "#73d0ff",
  "#d4bfff",
  "#95e6cb",
  "#ffffff",
];
const THEME_FG = "#b3b1ad";
const THEME_BG = "#0d1017";

/** Map an xterm palette index (0-255) to a CSS colour. */
function paletteToCss(index: number): string {
  if (index < 16) return ANSI_16[index] ?? THEME_FG;
  if (index < 232) {
    const i = index - 16;
    const step = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${step(Math.floor(i / 36))}, ${step(Math.floor((i % 36) / 6))}, ${step(i % 6)})`;
  }
  const v = 8 + (index - 232) * 10;
  return `rgb(${v}, ${v}, ${v})`;
}

/**
 * A cell's style as a CSS object. Every key is always present (empty when unset)
 * so a reactive `style` prop clears the previous cell's styling on change rather
 * than leaving it stale.
 */
function cellStyle(style: Style): Record<string, string> {
  const inv = style.inverse;
  const fg = inv ? style.bg : style.fg;
  const bg = inv ? style.fg : style.bg;
  return {
    color: fg != null ? paletteToCss(fg) : inv ? THEME_BG : "",
    backgroundColor: bg != null ? paletteToCss(bg) : inv ? THEME_FG : "",
    fontWeight: style.bold ? "bold" : "",
    fontStyle: style.italic ? "italic" : "",
    textDecoration: style.underline ? "underline" : "",
  };
}

/** `high`: one `<span>` per cell with reactive style + char (full colour, max nodes). */
function renderRowCells(
  changes: Stream.Stream<Row>,
  cols: number,
): ReadonlyArray<Node<never, never>> {
  return Array.from({ length: cols }, (_unused, c) =>
    h.span({ style: Stream.map(changes, (row) => cellStyle(row[c]?.style ?? DEFAULT_STYLE)) }, [
      Stream.map(changes, (row) => row[c]?.char ?? " "),
    ]),
  );
}

/** Render one row per the strategy: monochrome text segments, or coloured cells. */
function renderRow(
  ref: SubscriptionRef.SubscriptionRef<Row>,
  strategy: Strategy,
  cols: number,
): Node<never, never> {
  const changes = SubscriptionRef.changes(ref);
  if (strategy === "high") {
    return h.div({ class: "term-row" }, renderRowCells(changes, cols));
  }
  const segments = segmentsFor(strategy, cols);
  return h.div(
    { class: "term-row" },
    Array.from({ length: segments }, (_unused, s) =>
      Stream.map(changes, (row) => segmentText(row, s, segments)),
    ),
  );
}

/** Render the whole grid at the given strategy (`high` is coloured per cell). */
export function renderRows(
  rowRefs: ReadonlyArray<SubscriptionRef.SubscriptionRef<Row>>,
  strategy: Strategy,
  cols: number,
): Node<never, never> {
  return h.div(
    { class: "term" },
    rowRefs.map((ref) => renderRow(ref, strategy, cols)),
  );
}

/** Map a keyboard event to the bytes a PTY expects, or "" to ignore it. */
export function encodeKey(event: KeyboardEvent): string {
  switch (event.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    default:
      break;
  }
  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toLowerCase().charCodeAt(0);
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 96); // Ctrl-a .. Ctrl-z
  }
  return event.key.length === 1 ? event.key : "";
}
