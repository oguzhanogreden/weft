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
 * `<span>` per cell, a whole row's cells driven by one per-row binding
 * (`renderRowHigh`). That node count is the variable the perf meter measures;
 * `high` also carries SGR colour, truecolor included (see `src/specs.md`,
 * AC-RENDER and AC-TRUECOLOR).
 */

import { h } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, Option, pipe, type Scope, Stream, SubscriptionRef } from "effect";
import { feed, initParser } from "./ansi/parser";
import { blankRow, DEFAULT_STYLE, type Rgb, type Row, type Style } from "./grid";
import type { PaneBox } from "./grid-size";
import { segmentsFor, type Strategy } from "./perf";

export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

// ── Pixel-locked cell metrics (AC-PIXELGRID) ─────────────────────────────────
// The grid renders on fractional device pixels (measured ~7.83px cell advance,
// 16.25px row at the 13px font), so glyphs land off pixel boundaries and read
// soft. These snap cell advance and row height to whole device pixels; the lock
// cascades to every strategy via an inherited container style. Size stays 80x24
// (viewport-fitting is AC-RESIZE). `computePixelLock` is pure (unit-tested);
// `measureCell` reads the DOM once on mount (the `element-ref` pattern).

/** A measured monospace cell, in CSS pixels (from `getBoundingClientRect`). */
export interface CellMetrics {
  /** Natural horizontal advance of one cell, in CSS pixels. */
  readonly advance: number;
  /** Natural height of one row, in CSS pixels. */
  readonly height: number;
}

/** CSS values that snap the grid to whole device pixels. */
export interface PixelLock {
  /** Locked cell advance (CSS px); `cellWidth × devicePixelRatio` is a whole number. */
  readonly cellWidth: number;
  /** Locked row height (CSS px); `rowHeight × devicePixelRatio` is a whole number. */
  readonly rowHeight: number;
  /** Per-cell `letter-spacing` (CSS px) that widens `advance` to `cellWidth`. */
  readonly letterSpacing: number;
}

/** Repeated-glyph probe run; its measured width over its length is the cell advance. */
export const PROBE_TEXT = "0".repeat(80);

/** Snap a CSS-pixel length to the nearest whole device pixel. */
function snapToDevicePx(value: number, devicePixelRatio: number): number {
  return Math.round(value * devicePixelRatio) / devicePixelRatio;
}

/**
 * Snap measured metrics to whole device pixels. Pure, no DOM: cell advance rounds
 * to the nearest device pixel (realised as `letterSpacing`), row height likewise.
 */
export function computePixelLock(metrics: CellMetrics, devicePixelRatio: number): PixelLock {
  const cellWidth = snapToDevicePx(metrics.advance, devicePixelRatio);
  const rowHeight = snapToDevicePx(metrics.height, devicePixelRatio);
  return { cellWidth, rowHeight, letterSpacing: cellWidth - metrics.advance };
}

/** Natural cell advance + row height read from a mounted `PROBE_TEXT` probe element. */
export function measureCell(probe: HTMLElement): CellMetrics {
  const rect = probe.getBoundingClientRect();
  return { advance: rect.width / PROBE_TEXT.length, height: rect.height };
}

/**
 * `measureCell`, deferred until the probe has a layout box. The ref fires the
 * tick the element connects, before layout (the font may still be resolving), so
 * an immediate measure reads a 0-width rect. Poll until the probe has width, then
 * measure. Gives up after `attempts` and returns the last (possibly zero) reading
 * rather than blocking forever.
 */
export function measureCellWhenLaidOut(
  probe: HTMLElement,
  attempts = 60,
  intervalMillis = 16,
): Effect.Effect<CellMetrics> {
  return Effect.gen(function* () {
    let metrics = measureCell(probe);
    for (let i = 0; i < attempts && metrics.advance <= 0; i++) {
      yield* Effect.sleep(intervalMillis);
      metrics = measureCell(probe);
    }
    return metrics;
  });
}

/** A `PixelLock` as an inline style object for the grid container (cascades to every cell). */
export function pixelLockStyle(lock: PixelLock): Record<string, string> {
  return { letterSpacing: `${lock.letterSpacing}px`, lineHeight: `${lock.rowHeight}px` };
}

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

/** Map a truecolor `Rgb` to its CSS `rgb()` string. */
function rgbToCss(rgb: Rgb): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

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
    color:
      fg == null ? (inv ? THEME_BG : "") : typeof fg === "number" ? paletteToCss(fg) : rgbToCss(fg),
    backgroundColor:
      bg == null ? (inv ? THEME_FG : "") : typeof bg === "number" ? paletteToCss(bg) : rgbToCss(bg),
    fontWeight: style.bold ? "bold" : "",
    fontStyle: style.italic ? "italic" : "",
    textDecoration: style.underline ? "underline" : "",
  };
}

/** Converts a camelCase CSS property name to kebab-case, for `setProperty`. */
function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * `high`'s row: one binding drives every cell's text and style together,
 * diffed per cell against its last-applied values. `cols` static spans mount
 * as siblings; once the row `<div>` itself resolves, its `.children` gives
 * every span without a binding each, and one forked fiber loops over all of
 * them per row-change. One binding per cell (160 at 160 cols) was still the
 * dominant cost under load; one per row removed the gap to `med` entirely at
 * this size (`perf-analysis.md`).
 */
function renderRowHigh(changes: Stream.Stream<Row>, cols: number): Node<never, Scope.Scope> {
  return Effect.gen(function* () {
    const rowRef = yield* SubscriptionRef.make<Option.Option<HTMLElement>>(Option.none());

    yield* pipe(
      SubscriptionRef.changes(rowRef),
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runForEach((rowEl) => {
        // Safe: the static spans below are this element's only children, so
        // `.children` gives exactly `cols` of them, in column order.
        const spans = [...rowEl.value.children] as HTMLElement[];
        // Safe: each span below has exactly one static string child.
        const textNodes = spans.map((span) => span.firstChild as Text);
        const previousChars: string[] = spans.map(() => " ");
        const previousStyles: Array<Record<string, string>> = spans.map(() => ({}));

        return pipe(
          changes,
          Stream.runForEach((row) =>
            Effect.sync(() => {
              for (let c = 0; c < cols; c++) {
                const cell = row[c];
                const char = cell?.char ?? " ";
                if (char !== previousChars[c]) {
                  textNodes[c]!.data = char;
                  previousChars[c] = char;
                }
                const style = cellStyle(cell?.style ?? DEFAULT_STYLE);
                const prevStyle = previousStyles[c]!;
                for (const [key, value] of Object.entries(style)) {
                  if (prevStyle[key] !== value) {
                    spans[c]!.style.setProperty(camelToKebab(key), value);
                  }
                }
                previousStyles[c] = style;
              }
            }),
          ),
        );
      }),
      Effect.forkScoped,
    );

    return yield* h.div(
      { ref: rowRef, class: "term-row" },
      Array.from({ length: cols }, () => h.span({}, " ")),
    );
  });
}

/** Render one row per the strategy: monochrome text segments, or coloured cells. */
function renderRow(
  ref: SubscriptionRef.SubscriptionRef<Row>,
  strategy: Strategy,
  cols: number,
): Node<never, Scope.Scope> {
  const changes = SubscriptionRef.changes(ref);
  if (strategy === "high") {
    return renderRowHigh(changes, cols);
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
): Node<never, Scope.Scope> {
  return h.div(
    { class: "term" },
    rowRefs.map((ref) => renderRow(ref, strategy, cols)),
  );
}

/**
 * The space a grid may occupy, for auto-fit (AC-RESIZE): the viewport less the
 * body padding and whatever chrome sits above `pane`.
 *
 * Deliberately reads `documentElement.clientWidth` rather than the pane's own
 * width. `#root` is `fit-content`, so the pane is sized *by* the grid inside it,
 * and measuring it to choose that grid's size would be circular. The pane's
 * `top` is safe: it depends only on the chrome above, never on the grid.
 */
export function measureAvailableBox(pane: HTMLElement): PaneBox {
  const body = window.getComputedStyle(document.body);
  const padX = Number.parseFloat(body.paddingLeft) + Number.parseFloat(body.paddingRight);
  const padBottom = Number.parseFloat(body.paddingBottom);
  const { top } = pane.getBoundingClientRect();
  return {
    width: Math.max(0, document.documentElement.clientWidth - padX),
    height: Math.max(0, document.documentElement.clientHeight - top - padBottom),
  };
}

// ── Touch input (AC-MOBILE) ──────────────────────────────────────────────────
// A soft keyboard has no Esc, Tab, Ctrl, or arrows, which is most of what
// driving a shell needs. These are the pure encoding halves; the textarea and
// the accessory row itself live in `app.ts`.

/** One accessory-row key: what it reads as, and the bytes it sends. */
export interface AccessoryKey {
  readonly label: string;
  readonly bytes: string;
}

/**
 * The accessory row, in display order. Ctrl is deliberately absent: it is a
 * sticky modifier rather than a key that sends bytes, so `app.ts` renders it
 * separately and applies it via {@link controlByte}.
 */
export const ACCESSORY_KEYS: ReadonlyArray<AccessoryKey> = [
  { label: "esc", bytes: "\x1b" },
  { label: "tab", bytes: "\t" },
  { label: "↑", bytes: "\x1b[A" },
  { label: "↓", bytes: "\x1b[B" },
  { label: "←", bytes: "\x1b[D" },
  { label: "→", bytes: "\x1b[C" },
];

/**
 * The control byte for a printable character (`c` and `C` both give `\x03`), or
 * `""` when there is none. Used to apply an armed sticky Ctrl to a character
 * that arrived through the soft keyboard's `input` event, where `encodeKey` never
 * sees a `ctrlKey` flag. Covers `a`-`z` only, matching `encodeKey`.
 */
export function controlByte(char: string): string {
  if (char.length !== 1) return "";
  const code = char.toLowerCase().charCodeAt(0);
  if (code < 97 || code > 122) return ""; // a-z
  return String.fromCharCode(code - 96);
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
