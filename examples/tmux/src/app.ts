/**
 * tmux example: a browser terminal multiplexer on Weft (real PTY over WebSocket).
 *
 * Side-effect-free: exports `App` (no top-level mount) so tests can mount it with
 * a mock transport. `App` depends on the `PtyTransport` service; the concrete
 * layer is chosen by the entry point (`main.ts` = WebSocket, tests = mock).
 *
 * A control bar drives the perf harness across three axes: render strategy (how
 * many reactive text nodes per row), synthetic load, and grid size, with live
 * FPS and rows/sec meters.
 *
 * The two keyed regions are nested deliberately. Size owns the row refs and the
 * parser pump, so changing it tears both down and rebuilds at the new dimensions.
 * Strategy sits inside and only rebuilds the render, so switching it leaves the
 * grid content standing. See `src/specs.md`, AC-GRIDSIZE / AC-RENDER.
 */

import { h, List } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, Option, pipe, type Scope, Stream, SubscriptionRef } from "effect";
import { DEFAULT_GRID_SIZE, GRID_SIZES, type GridSize, gridSizeLabel } from "./grid-size";
import { type LoadLevel, makeFpsMeter, makeLoadStream, makeRateMeter, type Strategy } from "./perf";
import {
  computePixelLock,
  encodeKey,
  makeGrid,
  measureCellWhenLaidOut,
  type PixelLock,
  pixelLockStyle,
  PROBE_TEXT,
  pump,
  renderRows,
} from "./terminal";
import { PtyTransport, type TransportError } from "./transport";

/** Initial grid size for a mounted app. Omitted dimensions fall back to 160x48. */
export interface AppOptions {
  readonly cols?: number;
  readonly rows?: number;
}

const STRATEGIES: ReadonlyArray<Strategy> = ["low", "med", "high"];
const LOADS: ReadonlyArray<LoadLevel> = ["off", "low", "med", "high"];

/**
 * Select a grid size and mirror it into the URL, so a reload keeps the size and
 * the address bar stays shareable mid-benchmark (AC-GRIDSIZE).
 */
const selectSize = (
  sizeRef: SubscriptionRef.SubscriptionRef<GridSize>,
  size: GridSize,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* SubscriptionRef.set(sizeRef, size);
    yield* Effect.sync(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("cols", String(size.cols));
      url.searchParams.set("rows", String(size.rows));
      window.history.replaceState(null, "", url);
    });
  });

const controlBar = (
  strategyRef: SubscriptionRef.SubscriptionRef<Strategy>,
  loadRef: SubscriptionRef.SubscriptionRef<LoadLevel>,
  sizeRef: SubscriptionRef.SubscriptionRef<GridSize>,
  fps: Stream.Stream<number>,
  rowsPerSec: Stream.Stream<number>,
): Node<never, never> =>
  h.div({ class: "controls" }, [
    h.span({ class: "label" }, "strategy"),
    ...STRATEGIES.map((s) =>
      h.button(
        {
          type: "button",
          class: "level",
          "data-strategy": s,
          onclick: () => SubscriptionRef.set(strategyRef, s),
        },
        s,
      ),
    ),
    h.span({ class: "label" }, "load"),
    ...LOADS.map((l) =>
      h.button(
        {
          type: "button",
          class: "level",
          "data-load": l,
          onclick: () => SubscriptionRef.set(loadRef, l),
        },
        l,
      ),
    ),
    h.span({ class: "label" }, "size"),
    ...GRID_SIZES.map((size) =>
      h.button(
        {
          type: "button",
          class: "level",
          "data-size": gridSizeLabel(size),
          onclick: () => selectSize(sizeRef, size),
        },
        gridSizeLabel(size),
      ),
    ),
    h.span({ class: "meter fps" }, ["fps: ", Stream.map(fps, (n) => String(n))]),
    h.span({ class: "meter rows" }, ["rows/s: ", Stream.map(rowsPerSec, (n) => String(n))]),
  ]);

/**
 * The application root: one shell wired to the perf harness. `options` sets the
 * _initial_ grid size (`main.ts` seeds it from the query string); the control
 * bar's size buttons drive it from there. Defaults to 160x48.
 */
export const App = (options: AppOptions = {}): Node<TransportError, PtyTransport | Scope.Scope> =>
  Effect.gen(function* () {
    const initialSize: GridSize = {
      cols: options.cols ?? DEFAULT_GRID_SIZE.cols,
      rows: options.rows ?? DEFAULT_GRID_SIZE.rows,
    };

    const transport = yield* PtyTransport;
    const session = yield* transport.spawn(initialSize);

    // Default to `high`: the coloured, per-cell view, so real programs render in
    // colour out of the box (a menu's reverse-video selection band, a status bar).
    // `low`/`med` are opt-in monochrome perf baselines from the control bar (AC-RENDER).
    const strategyRef = yield* SubscriptionRef.make<Strategy>("high");
    const loadRef = yield* SubscriptionRef.make<LoadLevel>("off");
    const sizeRef = yield* SubscriptionRef.make<GridSize>(initialSize);
    const probeRef = yield* SubscriptionRef.make<Option.Option<HTMLElement>>(Option.none());
    const lockRef = yield* SubscriptionRef.make<Option.Option<PixelLock>>(Option.none());

    const fps = makeFpsMeter();
    const rate = makeRateMeter();
    yield* fps.start;

    // Measure one cell on mount, then lock the grid to whole device pixels (AC-PIXELGRID).
    // The probe ref fires the tick the element connects, before layout has given
    // it a box (the font may still be resolving), so a synchronous measure reads
    // a 0-width rect. Wait for a real box, then compute the lock once.
    yield* pipe(
      SubscriptionRef.changes(probeRef),
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runForEach((probe) =>
        Effect.gen(function* () {
          const metrics = yield* measureCellWhenLaidOut(probe.value);
          yield* SubscriptionRef.set(
            lockRef,
            Option.some(computePixelLock(metrics, window.devicePixelRatio)),
          );
        }),
      ),
      Effect.forkScoped,
    );

    // The measured lock cascades from the stable pane to every render strategy.
    const paneStyle = SubscriptionRef.changes(lockRef).pipe(
      Stream.map((lock) =>
        Option.match(lock, { onNone: (): Record<string, string> => ({}), onSome: pixelLockStyle }),
      ),
    );

    const onkeydown = (event: KeyboardEvent): Effect.Effect<void> => {
      const data = encodeKey(event);
      if (data === "") return Effect.void;
      event.preventDefault();
      return session.write(data);
    };

    // Two nested keyed regions, and the nesting is the point (AC-GRIDSIZE).
    //
    // Outer key = size. The item scope owns this size's row refs and pump fiber,
    // so when the key is dropped the renderer closes that scope, interrupting
    // every per-cell subscription before the next size allocates its own.
    //
    // Inner key = strategy. It re-renders the *same* refs, so switching strategy
    // leaves the grid content standing (the AC-RENDER invariant).
    const body = List.each(
      {
        of: SubscriptionRef.changes(sizeRef).pipe(Stream.map((size) => [size] as const)),
        by: gridSizeLabel,
      },
      (size: GridSize) =>
        Effect.gen(function* () {
          const rowRefs = yield* makeGrid(size.cols, size.rows);
          // Real PTY output plus the synthetic load stream feed one parser pump.
          const input = Stream.merge(session.output, makeLoadStream(loadRef, size.cols, size.rows));
          yield* pump(rowRefs, size.cols, size.rows, input, rate.bump);
          // Order is load-bearing: the pump above must already be listening, or
          // the SIGWINCH redraw this triggers races the new subscription and the
          // first frame is lost. Redundant at mount (spawn used this size), which
          // is what keeps every rendered size and the shell's idea of it in step.
          yield* session.resize(size.cols, size.rows);
          return yield* List.each(
            {
              of: SubscriptionRef.changes(strategyRef).pipe(Stream.map((s) => [s] as const)),
              by: (s: Strategy) => s,
            },
            (s: Strategy) => renderRows(rowRefs, s, size.cols),
          );
        }),
    );

    return yield* h.div({ class: "tmux-app" }, [
      controlBar(strategyRef, loadRef, sizeRef, fps.stream, rate.stream),
      h.div({ class: "terminal-pane", tabindex: "0", onkeydown, style: paneStyle }, [
        h.span({ ref: probeRef, class: "term-probe", "aria-hidden": "true" }, PROBE_TEXT),
        body,
      ]),
    ]);
  });
