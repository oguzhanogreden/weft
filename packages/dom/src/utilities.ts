import { Effect, Stream } from "effect";
import { RenderContext } from "./data";

/**
 * Generates the next unique stream-region ID.
 */
export function nextStreamId(): Effect.Effect<number, never, RenderContext> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;
    return ++context.streamIdCounter.current;
  });
}

/**
 * Generates the next unique Suspense-boundary ID.
 *
 * IDs are drawn from the same monotonic counter as stream-region IDs —
 * they only need to be unique within a single render tree.
 */
export const nextSuspenseId = nextStreamId;

/**
 * Checks if value is a Stream.
 * Uses `any` for E and R parameters to allow matching streams with any error/requirements.
 */
export function isStream(value: unknown): value is Stream.Stream<unknown, any, any> {
  return typeof value === "object" && value != null && Stream.StreamTypeId in value;
}

/**
 * Normalizes Effect/Stream to Stream
 */
export function normalizeToStream<A>(
  value: A | Effect.Effect<A> | Stream.Stream<A>,
): Stream.Stream<A> {
  if (isStream(value)) {
    return value;
  }
  if (Effect.isEffect(value)) {
    return Stream.fromEffect(value);
  }
  return Stream.make(value);
}
