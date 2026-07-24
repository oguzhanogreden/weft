/**
 * Terminal rendering + input for the tmux example.
 *
 * State is one `SubscriptionRef<Row>` per screen row (`makeGrid`). `pump` feeds a
 * byte stream through the pure parser in a scope-bound fiber and `set`s only the
 * rows whose copy-on-write reference changed, reporting the count so a meter can
 * track update throughput. `renderRows` renders those refs as reactive text.
 *
 * The render "strategy" is just how many reactive text nodes each row is split
 * into: 1 (whole line), a handful, or one per cell. That node/subscription count
 * is the variable the perf meter measures (see `src/specs.md`, AC-RENDER).
 */

import { h } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, type Scope, Stream, SubscriptionRef } from "effect";
import { feed, initParser } from "./ansi/parser";
import { blankRow, type Row } from "./grid";

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

/** Render one row as `segments` reactive text nodes fed by its ref. */
function renderRow(
  ref: SubscriptionRef.SubscriptionRef<Row>,
  segments: number,
): Node<never, never> {
  const changes = SubscriptionRef.changes(ref);
  return h.div(
    { class: "term-row" },
    Array.from({ length: segments }, (_unused, s) =>
      Stream.map(changes, (row) => segmentText(row, s, segments)),
    ),
  );
}

/** Render the whole grid at a given per-row segment count. */
export function renderRows(
  rowRefs: ReadonlyArray<SubscriptionRef.SubscriptionRef<Row>>,
  segments: number,
): Node<never, never> {
  return h.div(
    { class: "term" },
    rowRefs.map((ref) => renderRow(ref, segments)),
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
