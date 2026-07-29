/**
 * Performance instrumentation for the tmux example: an FPS meter, a rows/sec
 * meter, and a synthetic load generator. Lets you measure where Weft's reactive
 * DOM caps out across render strategies and load levels (see `src/specs.md`,
 * AC-RENDER / AC-PERF).
 *
 * The strategy "level" is the real perf variable: how many reactive text nodes
 * each row is split into. More nodes == more subscriptions firing per row change.
 */

import { Effect, type Scope, Stream, SubscriptionRef } from "effect";

/** Render strategy: reactive text nodes per row (low = 1, high = one per cell). */
export type Strategy = "low" | "med" | "high";

/** Synthetic load level, or `off` for the real shell only. */
export type LoadLevel = "off" | "low" | "med" | "high";

/** Milliseconds between synthetic full-screen repaints, per load level. */
const LOAD_INTERVAL_MS: Record<Exclude<LoadLevel, "off">, number> = {
  low: 100, // ~10 repaints/sec
  med: 16, // ~60 repaints/sec
  high: 4, // ~250 repaints/sec
};

/** Reactive text nodes per row for a strategy (`high` is one node per cell). */
export function segmentsFor(strategy: Strategy, cols: number): number {
  switch (strategy) {
    case "low":
      return 1;
    case "med":
      return Math.min(8, cols);
    case "high":
      return cols;
  }
}

const encoder = new TextEncoder();

/** A full-screen repaint whose every row changes with `frame` (max row churn). */
function generateFrameBytes(cols: number, rows: number, frame: number): Uint8Array {
  let out = "\x1b[H"; // cursor home
  for (let r = 0; r < rows; r++) {
    const label = `row ${r} · frame ${frame} `;
    const barWidth = Math.max(0, (frame + r) % Math.max(1, cols - label.length));
    let line = label + "#".repeat(barWidth);
    if (line.length > cols) line = line.slice(0, cols);
    out += `\x1b[K${line}`; // clear line, then content
    if (r < rows - 1) out += "\r\n";
  }
  return encoder.encode(out);
}

/**
 * A byte stream that emits synthetic repaints at the current `loadRef` rate.
 * Ticks fast and rate-limits by wall clock, so changing the level takes effect
 * immediately. Emits an empty chunk when off (a harmless no-op downstream).
 */
export function makeLoadStream(
  loadRef: SubscriptionRef.SubscriptionRef<LoadLevel>,
  cols: number,
  rows: number,
): Stream.Stream<Uint8Array> {
  const empty = new Uint8Array(0);
  let lastEmit = 0;
  let frame = 0;
  return Stream.tick("4 millis").pipe(
    Stream.mapEffect(() =>
      Effect.gen(function* () {
        const level = yield* SubscriptionRef.get(loadRef);
        if (level === "off") return empty;
        const now = performance.now();
        if (now - lastEmit < LOAD_INTERVAL_MS[level]) return empty;
        lastEmit = now;
        frame++;
        return generateFrameBytes(cols, rows, frame);
      }),
    ),
  );
}

/** Frames-per-second via `requestAnimationFrame`, sampled every 500ms. */
export function makeFpsMeter(): {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly stream: Stream.Stream<number>;
} {
  let frames = 0;
  let rafId = 0;
  let last = 0;
  const tick = () => {
    frames++;
    rafId = requestAnimationFrame(tick);
  };
  const start = Effect.gen(function* () {
    last = performance.now();
    rafId = requestAnimationFrame(tick);
    yield* Effect.addFinalizer(() => Effect.sync(() => cancelAnimationFrame(rafId)));
  });
  const stream = Stream.tick("500 millis").pipe(
    Stream.map(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fps = dt > 0 ? Math.round(frames / dt) : 0;
      frames = 0;
      return fps;
    }),
  );
  return { start, stream };
}

/** A counter you `bump`, sampled as a per-second rate every 500ms. */
export function makeRateMeter(): {
  readonly bump: (n: number) => void;
  readonly stream: Stream.Stream<number>;
} {
  let count = 0;
  let last = 0;
  let started = false;
  const bump = (n: number) => {
    count += n;
  };
  const stream = Stream.tick("500 millis").pipe(
    Stream.map(() => {
      const now = performance.now();
      if (!started) {
        started = true;
        last = now;
        count = 0;
        return 0;
      }
      const dt = (now - last) / 1000;
      last = now;
      const rate = dt > 0 ? Math.round(count / dt) : 0;
      count = 0;
      return rate;
    }),
  );
  return { bump, stream };
}
