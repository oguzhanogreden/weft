/**
 * In-memory `PtyTransport` for tests and backend-less dev. Replays a fixed list
 * of output chunks as PTY bytes and records everything the app writes, so a
 * browser test can assert both what rendered and what keystrokes were sent
 * without a real `node-pty` server (see `src/specs.md`, AC-TRANSPORT / AC-TEST).
 */

import { Effect, Layer, Stream } from "effect";
import { type PaneSession, PtyTransport } from "./transport";

const encoder = new TextEncoder();

/** A mock transport plus the shared write log a test can assert against. */
export interface MockHandle {
  readonly layer: Layer.Layer<PtyTransport>;
  /** Keystrokes the app sent, in order. */
  readonly writes: string[];
}

/** Build a mock transport whose spawned session replays `chunks` then ends. */
export const makeMockTransport = (chunks: readonly string[]): MockHandle => {
  const writes: string[] = [];
  const session: PaneSession = {
    output: Stream.fromIterable(chunks).pipe(Stream.map((chunk) => encoder.encode(chunk))),
    write: (data) =>
      Effect.sync(() => {
        writes.push(data);
      }),
    resize: () => Effect.void,
  };
  const layer = Layer.succeed(PtyTransport, { spawn: () => Effect.succeed(session) });
  return { layer, writes };
};
