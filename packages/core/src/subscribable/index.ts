import type { Effect, Stream } from "effect";
import { Predicate } from "effect";

/**
 * Unique brand identifying a {@link Subscribable}. Effect 4 dropped its own
 * `Subscribable`/`Readable` modules, so Weft carries this reactivity interface
 * locally; the string brand mirrors Effect 4's `"~effect/*"` TypeId convention
 * and backs the {@link isSubscribable} guard.
 */
export const TypeId = "~@weftui/core/Subscribable";

/**
 * Type of the {@link TypeId} brand.
 */
export type TypeId = typeof TypeId;

/**
 * A hot, await-first reactive value: `get` reads the current value as an
 * `Effect`, `changes` is a `Stream` of every value (including the current one).
 *
 * This is Weft's local replacement for Effect 3's `Subscribable`, preserved as
 * public API so `Source`, `Boundary`, and the DOM renderers keep the same
 * reactivity surface across the Effect 4 migration.
 */
export interface Subscribable<A, E = never, R = never> {
	readonly [TypeId]: TypeId;
	/** Read the current value. */
	readonly get: Effect.Effect<A, E, R>;
	/** Stream of every value, starting with the current one. */
	readonly changes: Stream.Stream<A, E, R>;
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
	[TypeId]: TypeId,
	get: options.get,
	changes: options.changes,
});

/**
 * Refinement guard: `true` when `u` carries the {@link TypeId} brand, i.e. was
 * produced by {@link make}. Used by `Source.toSubscribable` to thread an
 * existing `Subscribable` through by reference instead of re-wrapping it.
 */
export const isSubscribable = (u: unknown): u is Subscribable<unknown, unknown, unknown> =>
	Predicate.hasProperty(u, TypeId);
