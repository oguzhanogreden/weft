/**
 * The read-only viewer's screen: the terminal grid and the connection-status
 * dot, nothing else (see `src/specs.md`, AC-STREAM). Mounted by `main.ts`
 * instead of `App` when the page URL carries `role=viewer`, a frontend-only
 * hint independent of the server's own read-only/read-write decision (which
 * is made purely from which token, `PTY_TOKEN` or `PTY_VIEW_TOKEN`, the
 * connection presents).
 *
 * Side-effect-free, like `app.ts`: exports `ViewerApp` (no top-level mount) so
 * tests can mount it with a mock transport.
 *
 * Deliberately does not wire `session.write`/`session.resize`: a viewer's
 * keystrokes have nowhere to go by construction, not merely by omission. tmux
 * itself independently drops input from a read-only-attached client, so this
 * is a second, not the only, reason nothing a viewer types reaches the shell.
 * There is no size picker either; the grid always auto-fits its own viewport
 * (harmless to the shared session, since a read-only attach never resizes it,
 * see AC-STREAM).
 */

import { h, List } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, Option, pipe, type Scope, Stream, SubscriptionRef } from "effect";
import { RESIZE_SETTLE, statusDot } from "./app";
import { DEFAULT_GRID_SIZE, fitGridSize, type GridSize, gridSizeLabel } from "./grid-size";
import {
  computePixelLock,
  makeGrid,
  measureAvailableBox,
  measureCellWhenLaidOut,
  type PixelLock,
  pixelLockStyle,
  PROBE_TEXT,
  pump,
  renderRows,
} from "./terminal";
import { PtyTransport, type TransportError } from "./transport";

/** The viewer's screen: always auto-fit, no options to pin a size with. */
export const ViewerApp = (): Node<TransportError, PtyTransport | Scope.Scope> =>
  Effect.gen(function* () {
    const transport = yield* PtyTransport;
    const session = yield* transport.spawn(DEFAULT_GRID_SIZE);

    const sizeRef = yield* SubscriptionRef.make<GridSize>(DEFAULT_GRID_SIZE);
    const probeRef = yield* SubscriptionRef.make<Option.Option<HTMLElement>>(Option.none());
    const paneRef = yield* SubscriptionRef.make<Option.Option<HTMLElement>>(Option.none());
    const lockRef = yield* SubscriptionRef.make<Option.Option<PixelLock>>(Option.none());

    // Pixel-lock: measure one cell on mount, same as App (AC-PIXELGRID).
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

    // Always auto-fit; there is no pin option for a viewer (AC-RESIZE, minus pinning).
    const refit = Effect.gen(function* () {
      const pane = yield* SubscriptionRef.get(paneRef);
      const lock = yield* SubscriptionRef.get(lockRef);
      if (Option.isNone(pane) || Option.isNone(lock)) return;
      yield* SubscriptionRef.set(sizeRef, fitGridSize(measureAvailableBox(pane.value), lock.value));
    });

    yield* pipe(
      Stream.fromEventListener(window, "resize"),
      Stream.debounce(RESIZE_SETTLE),
      Stream.runForEach(() => refit),
      Effect.forkScoped,
    );

    yield* pipe(
      Stream.merge(
        Stream.map(SubscriptionRef.changes(lockRef), () => undefined),
        Stream.map(SubscriptionRef.changes(paneRef), () => undefined),
      ),
      Stream.runForEach(() => refit),
      Effect.forkScoped,
    );

    const paneStyle = SubscriptionRef.changes(lockRef).pipe(
      Stream.map((lock) =>
        Option.match(lock, { onNone: (): Record<string, string> => ({}), onSome: pixelLockStyle }),
      ),
    );

    // One keyed region (size only): there is no strategy picker, so `high` is
    // fixed, matching App's own default (the coloured, per-cell view).
    const body = List.each(
      {
        of: SubscriptionRef.changes(sizeRef).pipe(Stream.map((size) => [size] as const)),
        by: gridSizeLabel,
      },
      (size: GridSize) =>
        Effect.gen(function* () {
          const rowRefs = yield* makeGrid(size.cols, size.rows);
          yield* pump(rowRefs, size.cols, size.rows, session.output, () => {});
          return yield* renderRows(rowRefs, "high", size.cols);
        }),
    );

    return yield* h.div({ class: "tmux-app" }, [
      statusDot(session.status),
      h.div({ ref: paneRef, class: "terminal-pane", style: paneStyle }, [
        h.span({ ref: probeRef, class: "term-probe", "aria-hidden": "true" }, PROBE_TEXT),
        body,
      ]),
    ]);
  });
