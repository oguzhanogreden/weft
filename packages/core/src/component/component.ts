import type { Effect, Scope, Subscribable } from "effect";
import { Data } from "effect";
import type { JSXNode, MaybeReactive } from "~/types";

// Re-exported reliable guard, keyed off Subscribable's TypeId.
export { isSubscribable } from "effect/Subscribable";

/**
 * The inside (author-facing) view of props: every declared slot becomes a
 * read-only `Subscribable` handle exposing `.changes` (live stream) and `.get`
 * (await-first current value).
 */
export type Reactive<P> = {
  readonly [K in keyof P]: Subscribable.Subscribable<P[K], NoPropValue>;
};

declare const RawProps: unique symbol;

/**
 * A defined component. Brands the render function with its raw prop shape `P`
 * so `JSX.LibraryManagedAttributes` can derive the caller-facing view
 * (`MaybeReactive` per slot) without lossily inverting `Subscribable`.
 */
export interface Component<P> {
  (props: Reactive<P>): JSXNode;
  readonly [RawProps]?: P;
}

/** Extracts the raw prop shape a `Component` was defined with. */
export type PropsOf<C> = C extends Component<infer P> ? P : never;

/**
 * Raised by `Subscribable.get` when a `Stream`-sourced prop completes without
 * ever emitting a value. The only source kind that can be legitimately absent.
 */
export class NoPropValue extends Data.TaggedError("NoPropValue")<{
  readonly key?: string;
}> {}

/**
 * Define a component from a render function. `P` is the raw prop shape, written
 * once; the render function receives it mapped to `Reactive<P>`.
 *
 * @example
 * ```tsx
 * const Greeting = component<{ name: string }>((props) => (
 *   <div>{props.name.changes}</div>
 * ));
 * ```
 */
export declare function component<P>(render: (props: Reactive<P>) => JSXNode): Component<P>;

/**
 * Normalize one caller-facing value into an await-first, hot `Subscribable`.
 *
 * - existing `Subscribable` → returned by reference (no new ref/fiber);
 * - static `T` → `get` succeeds immediately, `changes` emits once;
 * - `Effect<T>` → memoized (runs once), `changes` emits the resolved value once;
 * - `Stream<T>` → forks a scoped pump fiber holding the latest value in a
 *   `SubscriptionRef`; `get` is await-first and fails `NoPropValue` if the
 *   source ends before emitting.
 *
 * Scoped: the pump fiber terminates when the enclosing scope closes.
 */
export declare function toSubscribable<A>(
  source: MaybeReactive<A>,
): Effect.Effect<Subscribable.Subscribable<A, NoPropValue>, never, Scope.Scope>;
