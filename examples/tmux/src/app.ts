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
 *
 * Size is auto-fitted to the viewport by default and re-fits on resize; clicking
 * a preset pins it and stops tracking (AC-RESIZE). Touch input rides a hidden
 * textarea plus an accessory row, since a soft keyboard has no Esc/Tab/Ctrl or
 * arrows (AC-MOBILE).
 *
 * The control bar also shows a connection-status dot (`connecting`/`live`/
 * `offline`/`unauthorized`), reflecting `session.status`. Reconnect itself lives
 * in the transport, not here: this component only renders whatever state it is
 * told (AC-REMOTE).
 */

import { h, List } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, Option, pipe, type Scope, Stream, SubscriptionRef } from "effect";
import {
  DEFAULT_GRID_SIZE,
  fitGridSize,
  GRID_SIZES,
  type GridSize,
  gridSizeLabel,
} from "./grid-size";
import { type LoadLevel, makeFpsMeter, makeLoadStream, makeRateMeter, type Strategy } from "./perf";
import {
  ACCESSORY_KEYS,
  computePixelLock,
  controlByte,
  encodeKey,
  makeGrid,
  measureAvailableBox,
  measureCellWhenLaidOut,
  type PixelLock,
  pixelLockStyle,
  PROBE_TEXT,
  pump,
  renderRows,
} from "./terminal";
import { type ConnectionStatus, PtyTransport, type TransportError } from "./transport";

/**
 * Initial grid size for a mounted app. Supplying either dimension also *pins*
 * the size, turning auto-fit off: it is an explicit choice, the same way a
 * `?cols=` URL is. Omit both to open in auto-fit (AC-RESIZE).
 */
export interface AppOptions {
  readonly cols?: number;
  readonly rows?: number;
}

/**
 * How long a resize must settle before re-fitting; each re-fit rebuilds the
 * grid. Exported: `ViewerApp` auto-fits too and must debounce identically.
 */
export const RESIZE_SETTLE = "150 millis";

const STRATEGIES: ReadonlyArray<Strategy> = ["low", "med", "high"];
const LOADS: ReadonlyArray<LoadLevel> = ["off", "low", "med", "high"];

/** Keep the hidden textarea focused, so tapping a key does not dismiss the soft keyboard. */
const keepFocus = (event: Event): Effect.Effect<void> => Effect.sync(() => event.preventDefault());

/** A boolean ref as a reactive attribute value ("true"/"false"). */
const boolAttr = (ref: SubscriptionRef.SubscriptionRef<boolean>): Stream.Stream<string> =>
  Stream.map(SubscriptionRef.changes(ref), String);

/** A short, human-facing word for each connection state (AC-REMOTE). */
const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "connecting…",
  live: "live",
  offline: "offline",
  unauthorized: "unauthorized",
};

/**
 * The connection-status dot: reflects `status` via class, `data-status`, and
 * text. Shared between `App`'s control bar and `ViewerApp` (AC-STREAM), which
 * has no control bar to put one in otherwise.
 */
export const statusDot = (status: Stream.Stream<ConnectionStatus>): Node<never, never> =>
  h.span(
    {
      class: Stream.map(status, (s) => `status status-${s}`),
      "data-status": Stream.map(status, (s): string => s),
    },
    [Stream.map(status, (s) => STATUS_LABEL[s])],
  );

interface ControlBarProps {
  readonly strategyRef: SubscriptionRef.SubscriptionRef<Strategy>;
  readonly loadRef: SubscriptionRef.SubscriptionRef<LoadLevel>;
  readonly sizeRef: SubscriptionRef.SubscriptionRef<GridSize>;
  readonly trackingRef: SubscriptionRef.SubscriptionRef<boolean>;
  readonly openRef: SubscriptionRef.SubscriptionRef<boolean>;
  readonly status: Stream.Stream<ConnectionStatus>;
  readonly shareUrl: Stream.Stream<Option.Option<string>>;
  readonly fps: Stream.Stream<number>;
  readonly rowsPerSec: Stream.Stream<number>;
}

/**
 * Pin a grid size: set it and stop auto-fit tracking, then mirror it into the
 * URL so a reload keeps it and the address bar stays shareable mid-benchmark.
 */
const pinSize = (props: ControlBarProps, size: GridSize): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Tracking off first: a re-fit landing between these two would otherwise
    // clobber the size just picked. `refit` reads `trackingRef` before anything
    // else, so once it is false the fit is inert.
    yield* SubscriptionRef.set(props.trackingRef, false);
    yield* SubscriptionRef.set(props.sizeRef, size);
    yield* Effect.sync(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("cols", String(size.cols));
      url.searchParams.set("rows", String(size.rows));
      window.history.replaceState(null, "", url);
    });
  });

/** Resume auto-fit, dropping the pinned size from the URL. */
const resumeAuto = (props: ControlBarProps): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("cols");
      url.searchParams.delete("rows");
      window.history.replaceState(null, "", url);
    });
    // Clearing the URL first matters on reload, not here: a leftover `?cols=`
    // would re-pin on next load and silently undo the resume.
    yield* SubscriptionRef.set(props.trackingRef, true);
  });

/** Write a share URL to the clipboard (see `src/specs.md`, AC-STREAM). */
const copyShareUrl = (url: string): Effect.Effect<void> =>
  Effect.promise(() => navigator.clipboard.writeText(url));

/**
 * The share control: a "share" button once `shareUrl` resolves to `Some`,
 * nothing before (AC-STREAM). Its own function, like `renderRow`/`renderRows`
 * in `terminal.ts`, rather than inlined into `controlBar`'s tree.
 */
const shareControl = (
  shareUrl: Stream.Stream<Option.Option<string>>,
): Stream.Stream<Node<never, never>> =>
  Stream.map(shareUrl, (url) =>
    Option.match(url, {
      onNone: () => h.span({ class: "share", "aria-hidden": "true" }, []),
      onSome: (url) =>
        h.button(
          { type: "button", class: "level share", onclick: () => copyShareUrl(url) },
          "share",
        ),
    }),
  );

const controlBar = (props: ControlBarProps): Node<never, never> =>
  h.div({ class: "controls" }, [
    h.button(
      {
        type: "button",
        class: "level controls-toggle",
        "data-controls-toggle": "",
        onclick: () => SubscriptionRef.update(props.openRef, (open) => !open),
      },
      "≡ controls",
    ),
    h.div({ class: "control-groups", "data-open": boolAttr(props.openRef) }, [
      h.span({ class: "label" }, "strategy"),
      ...STRATEGIES.map((s) =>
        h.button(
          {
            type: "button",
            class: "level",
            "data-strategy": s,
            onclick: () => SubscriptionRef.set(props.strategyRef, s),
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
            onclick: () => SubscriptionRef.set(props.loadRef, l),
          },
          l,
        ),
      ),
      h.span({ class: "label" }, "size"),
      h.button(
        {
          type: "button",
          class: "level",
          "data-size": "auto",
          "data-active": boolAttr(props.trackingRef),
          onclick: () => resumeAuto(props),
        },
        "auto",
      ),
      ...GRID_SIZES.map((size) =>
        h.button(
          {
            type: "button",
            class: "level",
            "data-size": gridSizeLabel(size),
            onclick: () => pinSize(props, size),
          },
          gridSizeLabel(size),
        ),
      ),
      shareControl(props.shareUrl),
    ]),
    statusDot(props.status),
    h.span({ class: "meter fps" }, ["fps: ", Stream.map(props.fps, (n) => String(n))]),
    h.span({ class: "meter rows" }, ["rows/s: ", Stream.map(props.rowsPerSec, (n) => String(n))]),
  ]);

/**
 * The touch accessory row: the keys a soft keyboard does not have. Hidden on
 * fine-pointer devices by CSS, so desktop is untouched (AC-MOBILE).
 */
const accessoryRow = (
  write: (data: string) => Effect.Effect<void>,
  ctrlArmedRef: SubscriptionRef.SubscriptionRef<boolean>,
): Node<never, never> =>
  h.div({ class: "accessory" }, [
    ...ACCESSORY_KEYS.map((key) =>
      h.button(
        {
          type: "button",
          class: "accessory-key",
          "data-accessory": key.label,
          onmousedown: keepFocus,
          onclick: () => write(key.bytes),
        },
        key.label,
      ),
    ),
    h.button(
      {
        type: "button",
        class: "accessory-key",
        "data-accessory": "ctrl",
        "data-armed": boolAttr(ctrlArmedRef),
        onmousedown: keepFocus,
        onclick: () => SubscriptionRef.update(ctrlArmedRef, (armed) => !armed),
      },
      "ctrl",
    ),
  ]);

/**
 * The application root: one shell wired to the perf harness. `options` sets the
 * initial grid size and pins it; omit it to open in auto-fit.
 */
export const App = (options: AppOptions = {}): Node<TransportError, PtyTransport | Scope.Scope> =>
  Effect.gen(function* () {
    const pinned = options.cols !== undefined || options.rows !== undefined;
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
    const trackingRef = yield* SubscriptionRef.make<boolean>(!pinned);
    const openRef = yield* SubscriptionRef.make<boolean>(false);
    const ctrlArmedRef = yield* SubscriptionRef.make<boolean>(false);
    const probeRef = yield* SubscriptionRef.make<Option.Option<HTMLElement>>(Option.none());
    // `ref` is invariant, so each must match what its tag resolves to.
    const paneRef = yield* SubscriptionRef.make<Option.Option<HTMLElement>>(Option.none());
    const inputRef = yield* SubscriptionRef.make<Option.Option<HTMLTextAreaElement>>(Option.none());
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

    // Spellcheck off, imperatively: see the textarea's props for why the
    // declarative route sets it to the opposite of what is written there.
    yield* pipe(
      SubscriptionRef.changes(inputRef),
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runForEach((field) => Effect.sync(() => (field.value.spellcheck = false))),
      Effect.forkScoped,
    );

    // Auto-fit (AC-RESIZE). Inert while a size is pinned, and until both the pane
    // and the measured lock exist: fitting against an unmeasured cell would just
    // yield the fallback and thrash the grid for nothing.
    const refit = Effect.gen(function* () {
      if (!(yield* SubscriptionRef.get(trackingRef))) return;
      const pane = yield* SubscriptionRef.get(paneRef);
      const lock = yield* SubscriptionRef.get(lockRef);
      if (Option.isNone(pane) || Option.isNone(lock)) return;
      yield* SubscriptionRef.set(sizeRef, fitGridSize(measureAvailableBox(pane.value), lock.value));
    });

    // Debounced, because every re-fit tears down a whole grid: an undebounced
    // window drag would rebuild thousands of cells per pixel. A settled size that
    // crosses no cell boundary is inert anyway (same label, same list key).
    yield* pipe(
      Stream.fromEventListener(window, "resize"),
      Stream.debounce(RESIZE_SETTLE),
      Stream.runForEach(() => refit),
      Effect.forkScoped,
    );

    // Re-fit on every input `refit` reads, not just the one expected to land
    // last. The lock resolves after the pane today (it polls for a laid-out
    // probe inside it), but depending on that ordering would leave auto-fit
    // silently dead if it ever changed.
    yield* pipe(
      Stream.merge(
        Stream.map(SubscriptionRef.changes(lockRef), () => undefined),
        Stream.merge(
          Stream.map(SubscriptionRef.changes(paneRef), () => undefined),
          Stream.map(SubscriptionRef.changes(trackingRef), () => undefined),
        ),
      ),
      Stream.runForEach(() => refit),
      Effect.forkScoped,
    );

    // The measured lock cascades from the stable pane to every render strategy.
    const paneStyle = SubscriptionRef.changes(lockRef).pipe(
      Stream.map((lock) =>
        Option.match(lock, { onNone: (): Record<string, string> => ({}), onSome: pixelLockStyle }),
      ),
    );

    // Hardware keyboard. Every key this encodes is `preventDefault`ed, so the
    // character never reaches the textarea and no `input` event follows. That is
    // what keeps the two input paths from double-sending (AC-MOBILE).
    const onkeydown = (event: KeyboardEvent): Effect.Effect<void> => {
      const data = encodeKey(event);
      if (data === "") return Effect.void;
      event.preventDefault();
      return session.write(data);
    };

    // Soft keyboard. Mobile reports `key: "Unidentified"` on keydown, so
    // `encodeKey` returns "" and the character lands here instead.
    const oninput = (event: Event): Effect.Effect<void> =>
      Effect.gen(function* () {
        const field = event.currentTarget as HTMLTextAreaElement;
        const text = field.value;
        field.value = "";
        if (text === "") return;
        if (!(yield* SubscriptionRef.get(ctrlArmedRef))) return yield* session.write(text);
        // Sticky ctrl applies to the next character only, then disarms.
        yield* SubscriptionRef.set(ctrlArmedRef, false);
        const byte = controlByte(text[0]!);
        yield* session.write(byte === "" ? text : byte + text.slice(1));
      });

    // Tapping the grid summons the soft keyboard. `preventScroll` keeps the pane
    // from being scrolled out from under it.
    const onclick = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const field = yield* SubscriptionRef.get(inputRef);
        if (Option.isSome(field)) field.value.focus({ preventScroll: true });
      });

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
      controlBar({
        strategyRef,
        loadRef,
        sizeRef,
        trackingRef,
        openRef,
        status: session.status,
        shareUrl: session.shareUrl,
        fps: fps.stream,
        rowsPerSec: rate.stream,
      }),
      accessoryRow(session.write, ctrlArmedRef),
      h.div(
        {
          ref: paneRef,
          class: "terminal-pane",
          tabindex: "0",
          onkeydown,
          onclick,
          style: paneStyle,
        },
        [
          h.span({ ref: probeRef, class: "term-probe", "aria-hidden": "true" }, PROBE_TEXT),
          h.textarea({
            ref: inputRef,
            class: "term-input",
            "aria-hidden": "true",
            // No `autocomplete="off"`: core's `HTMLAutocomplete` union is
            // field-name tokens only, so "off" does not typecheck.
            // No `spellcheck` either: core types it `"true" | "false"`, but the
            // renderer assigns it to the boolean IDL property, where the string
            // "false" is truthy and turns spellcheck *on*. Set below via the ref.
            autocapitalize: "off",
            autocorrect: "off",
            oninput,
          }),
          body,
        ],
      ),
    ]);
  });
