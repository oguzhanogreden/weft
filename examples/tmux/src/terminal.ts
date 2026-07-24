/**
 * A single terminal pane rendered with Weft's reactive DOM.
 *
 * State is one `SubscriptionRef<Row>` per screen row. The PTY output stream feeds
 * the pure parser in a scope-bound fiber; after each chunk only the rows whose
 * copy-on-write reference actually changed are `set`, so an untouched row never
 * re-renders. Keystrokes flow back out through `session.write`.
 *
 * This baseline renders each row as a reactive text child (monochrome). Styled
 * per-run `<span>` rendering (Mode B) and the per-cell mode (Mode A) layer on top
 * of the same per-row ref structure (see `src/specs.md`, AC-RENDER).
 */

import { h } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, type Scope, Stream, SubscriptionRef } from "effect";
import { feed, initParser } from "./ansi/parser";
import { blankRow, type Row } from "./grid";

/** Default grid size. Kept fixed for the demo/tests; a real pane measures its box. */
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

/** Render a row's cells as a plain string, preserving blanks for stable layout. */
const rowToLine = (row: Row): string => row.map((cell) => cell.char).join("");

/** Map a keyboard event to the bytes a PTY expects, or "" to ignore it. */
const encodeKey = (event: KeyboardEvent): string => {
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
};

export interface TerminalOptions {
  readonly cols?: number;
  readonly rows?: number;
}

/** Build one terminal pane bound to a live `PaneSession`. */
export const Terminal = (
  session: {
    readonly output: Stream.Stream<Uint8Array>;
    readonly write: (data: string) => Effect.Effect<void>;
  },
  options: TerminalOptions = {},
): Node<never, Scope.Scope> =>
  Effect.gen(function* () {
    const cols = options.cols ?? DEFAULT_COLS;
    const rows = options.rows ?? DEFAULT_ROWS;

    const rowRefs = yield* Effect.all(
      Array.from({ length: rows }, () => SubscriptionRef.make<Row>(blankRow(cols))),
    );

    // Parser + last-rendered lines live in this fiber only (no concurrency).
    let parser = initParser(cols, rows);
    let previous = parser.term.lines;
    const decoder = new TextDecoder();

    const onChunk = (bytes: Uint8Array) =>
      Effect.gen(function* () {
        parser = feed(parser, decoder.decode(bytes, { stream: true }));
        const lines = parser.term.lines;
        for (let i = 0; i < rows; i++) {
          // Reference identity: copy-on-write means only changed rows differ.
          if (lines[i] !== previous[i]) {
            const ref = rowRefs[i];
            if (ref) yield* SubscriptionRef.set(ref, lines[i] ?? blankRow(cols));
          }
        }
        previous = lines;
      });

    yield* Effect.forkScoped(Stream.runForEach(session.output, onChunk));

    const onkeydown = (event: KeyboardEvent): Effect.Effect<void> => {
      const data = encodeKey(event);
      if (data === "") return Effect.void;
      event.preventDefault();
      return session.write(data);
    };

    const renderRow = (ref: SubscriptionRef.SubscriptionRef<Row>) =>
      h.div({ class: "term-row" }, [Stream.map(SubscriptionRef.changes(ref), rowToLine)]);

    return yield* h.pre({ class: "term", tabindex: "0", onkeydown }, rowRefs.map(renderRow));
  });
