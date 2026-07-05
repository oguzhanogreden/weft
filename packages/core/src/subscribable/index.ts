import type { Effect, Stream } from "effect";
import { Predicate } from "effect";

/**
 * Unique brand identifying a {@link Subscribable}, and the key under which its
 * `get`/`changes` channels are held. Effect 4 dropped its own
 * `Subscribable`/`Readable` modules, so Weft carries this reactivity interface
 * locally; the string brand mirrors Effect 4's `"~effect/*"` TypeId convention
 * (e.g. `SubscriptionRef`), keeping the channels off the public shape so they
 * are read through the {@link get} / {@link changes} accessors, uniformly with
 * `SubscriptionRef.get` / `SubscriptionRef.changes`.
 */
export const TypeId = "~@weftui/core/Subscribable";

/**
 * Type of the {@link TypeId} brand.
 */
export type TypeId = typeof TypeId;

/**
 * A hot, await-first reactive value. Read the current value with {@link get}
 * (an `Effect`) and the stream of every value (starting with the current one)
 * with {@link changes} (a `Stream`) — module accessors that mirror Effect 4's
 * `SubscriptionRef` surface rather than exposing the channels as members.
 *
 * This is Weft's local replacement for Effect 3's `Subscribable`, preserved as
 * public API so `Source`, `Boundary`, and the DOM renderers keep the same
 * reactivity surface across the Effect 4 migration.
 */
export interface Subscribable<A, E = never, R = never> {
  readonly [TypeId]: {
    readonly get: Effect.Effect<A, E, R>;
    readonly changes: Stream.Stream<A, E, R>;
  };
}

/**
 * Build a {@link Subscribable} from a `get` effect and a `changes` stream. The
 * caller owns the semantics of the two channels (e.g. hot vs. cold, whether
 * `changes` replays the current value); `make` only stamps the brand.
 */
export const make = <A, E = never, R = never>(options: {
  readonly get: Effect.Effect<A, E, R>;
  readonly changes: Stream.Stream<A, E, R>;
}): Subscribable<A, E, R> => ({
  [TypeId]: { get: options.get, changes: options.changes },
});

/**
 * Read the current value of a {@link Subscribable} as an `Effect`. Mirrors
 * `SubscriptionRef.get`.
 */
export const get = <A, E, R>(self: Subscribable<A, E, R>): Effect.Effect<A, E, R> =>
  self[TypeId].get;

/**
 * The `Stream` of every value of a {@link Subscribable}, starting with the
 * current one. Mirrors `SubscriptionRef.changes`.
 */
export const changes = <A, E, R>(self: Subscribable<A, E, R>): Stream.Stream<A, E, R> =>
  self[TypeId].changes;

/**
 * Refinement guard: `true` when `u` carries the {@link TypeId} brand, i.e. was
 * produced by {@link make}. Used by `Source.toSubscribable` to thread an
 * existing `Subscribable` through by reference instead of re-wrapping it.
 */
export const isSubscribable = (u: unknown): u is Subscribable<unknown, unknown, unknown> =>
  Predicate.hasProperty(u, TypeId);
