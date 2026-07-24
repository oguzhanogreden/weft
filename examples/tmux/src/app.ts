/**
 * tmux example: a browser terminal multiplexer on Weft (real PTY over WebSocket).
 *
 * Side-effect-free: exports `App` (no top-level mount) so tests can mount it with
 * a mock transport. `App` depends on the `PtyTransport` service; the concrete
 * layer is chosen by the entry point (`main.ts` = WebSocket, tests = mock).
 *
 * A control bar drives the perf harness: a render-strategy level (how many
 * reactive text nodes per row) and a synthetic load level, with live FPS and
 * rows/sec meters. The single set of per-row refs is shared: changing strategy
 * only rebuilds the render (via a `List.each` keyed on the level), while the
 * parser pump feeding the refs stays put.
 */

import { h, List } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, Option, pipe, type Scope, Stream, SubscriptionRef } from "effect";
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

const COLS = 80;
const ROWS = 24;

const STRATEGIES: ReadonlyArray<Strategy> = ["low", "med", "high"];
const LOADS: ReadonlyArray<LoadLevel> = ["off", "low", "med", "high"];

const controlBar = (
  strategyRef: SubscriptionRef.SubscriptionRef<Strategy>,
  loadRef: SubscriptionRef.SubscriptionRef<LoadLevel>,
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
    h.span({ class: "meter fps" }, ["fps: ", Stream.map(fps, (n) => String(n))]),
    h.span({ class: "meter rows" }, ["rows/s: ", Stream.map(rowsPerSec, (n) => String(n))]),
  ]);

/** The application root: one shell wired to the perf harness. */
export const App = (): Node<TransportError, PtyTransport | Scope.Scope> =>
  Effect.gen(function* () {
    const transport = yield* PtyTransport;
    const session = yield* transport.spawn({ cols: COLS, rows: ROWS });

    const rowRefs = yield* makeGrid(COLS, ROWS);
    // Default to `high`: the coloured, per-cell view, so real programs render in
    // colour out of the box (a menu's reverse-video selection band, a status bar).
    // `low`/`med` are opt-in monochrome perf baselines from the control bar (AC-RENDER).
    const strategyRef = yield* SubscriptionRef.make<Strategy>("high");
    const loadRef = yield* SubscriptionRef.make<LoadLevel>("off");
    const probeRef = yield* SubscriptionRef.make<Option.Option<HTMLElement>>(Option.none());
    const lockRef = yield* SubscriptionRef.make<Option.Option<PixelLock>>(Option.none());

    const fps = makeFpsMeter();
    const rate = makeRateMeter();
    yield* fps.start;

    // Real PTY output plus the synthetic load stream feed one parser pump.
    const input = Stream.merge(session.output, makeLoadStream(loadRef, COLS, ROWS));
    yield* pump(rowRefs, COLS, ROWS, input, rate.bump);

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

    // Rebuild the render (only) when the strategy changes; the refs persist.
    const body = List.each(
      {
        of: SubscriptionRef.changes(strategyRef).pipe(Stream.map((s) => [s] as const)),
        by: (s: Strategy) => s,
      },
      (s: Strategy) => renderRows(rowRefs, s, COLS),
    );

    return yield* h.div({ class: "tmux-app" }, [
      controlBar(strategyRef, loadRef, fps.stream, rate.stream),
      h.div({ class: "terminal-pane", tabindex: "0", onkeydown, style: paneStyle }, [
        h.span({ ref: probeRef, class: "term-probe", "aria-hidden": "true" }, PROBE_TEXT),
        body,
      ]),
    ]);
  });
