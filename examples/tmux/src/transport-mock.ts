/**
 * In-memory `PtyTransport` for tests and backend-less dev. Replays a fixed list
 * of output chunks as PTY bytes and records everything the app writes, so a
 * browser test can assert both what rendered and what keystrokes were sent
 * without a real `node-pty` server (see `src/specs.md`, AC-TRANSPORT / AC-TEST).
 */

import { Effect, Layer, Stream, SubscriptionRef } from "effect";
import {
  type ConnectionStatus,
  type PaneSession,
  PtyTransport,
  type SpawnOptions,
} from "./transport";

const encoder = new TextEncoder();

/** A mock transport plus the shared logs a test can assert against. */
export interface MockHandle {
  readonly layer: Layer.Layer<PtyTransport>;
  /** Keystrokes the app sent, in order. Empty while `setStatus` has moved off `live` (AC-REMOTE). */
  readonly writes: string[];
  /**
   * Grid sizes the app reported, in order. Lets a test assert the PTY was told
   * about a size change, not merely that the DOM re-rendered (AC-GRIDSIZE).
   */
  readonly resizes: SpawnOptions[];
  /**
   * Drive the session's connection status, so a test can simulate a drop and
   * recovery without a real socket (AC-REMOTE). Starts at `live`, so every
   * test unrelated to connection state is unaffected.
   */
  readonly setStatus: (status: ConnectionStatus) => Effect.Effect<void>;
}

/** Build a mock transport whose spawned session replays `chunks` then ends. */
export const makeMockTransport = (chunks: readonly string[]): MockHandle => {
  const writes: string[] = [];
  const resizes: SpawnOptions[] = [];
  const statusRef = Effect.runSync(SubscriptionRef.make<ConnectionStatus>("live"));
  const session: PaneSession = {
    output: Stream.fromIterable(chunks).pipe(Stream.map((chunk) => encoder.encode(chunk))),
    status: SubscriptionRef.changes(statusRef),
    write: (data) =>
      Effect.gen(function* () {
        if ((yield* SubscriptionRef.get(statusRef)) !== "live") return;
        writes.push(data);
      }),
    resize: (cols, rows) =>
      Effect.sync(() => {
        resizes.push({ cols, rows });
      }),
  };
  const layer = Layer.succeed(PtyTransport, { spawn: () => Effect.succeed(session) });
  return { layer, writes, resizes, setStatus: (status) => SubscriptionRef.set(statusRef, status) };
};
