import type { Effect, Scope, Subscribable } from "effect";
import { Data } from "effect";
import type { YieldWrap } from "effect/Utils";
import type { JSXNode, JSXRequirements, Source } from "~/types";

// Re-exported reliable guard, keyed off Subscribable's TypeId.
export { isSubscribable } from "effect/Subscribable";

/**
 * The inside (author-facing) view of props: every declared slot becomes a
 * read-only `Subscribable` handle exposing `.changes` (live stream) and `.get`
 * (await-first current value). `children` is exempt — it passes through with its
 * declared type so reactive children flow via `JSXNode`'s own arms and
 * render-prop/headless patterns keep their raw callable shape.
 */
export type Reactive<P> = {
  readonly [K in keyof P]: K extends "children"
    ? P[K]
    : Subscribable.Subscribable<P[K], NoPropValue>;
};

/**
 * The caller-facing view of props: every declared slot widens to `Source`, so a
 * prop declared `name: string` accepts a static value, a `Stream`, an `Effect`,
 * or an existing `Subscribable`. `children` is exempt — it passes through with
 * its declared type (no `Source` widening).
 */
export type PropsIn<P> = {
  [K in keyof P]: K extends "children" ? P[K] : Source<P[K]>;
};

declare const RawProps: unique symbol;

/**
 * A defined component. The call signature matches runtime — caller props
 * (`PropsIn<P>`) in, the body's effect (`Effect<JSXNode, …>`) out. The
 * `[RawProps]` brand carries the raw shape `P` so `JSX.LibraryManagedAttributes`
 * can derive the caller-facing view without lossily inverting `Subscribable`
 * (the call signature is not used for that inference).
 */
export interface Component<P> {
  (props: PropsIn<P>): Effect.Effect<JSXNode, any, JSXRequirements | Scope.Scope>;
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
  source: Source<A>,
): Effect.Effect<Subscribable.Subscribable<A, NoPropValue>, never, Scope.Scope>;

export namespace Component {
  /**
   * Define a component from an `Effect.gen`-style generator body. `P` is the raw
   * prop shape, written once as the sole type argument; the body receives it
   * mapped to `Reactive<P>` and `return`s the `JSXNode`.
   *
   * Unlike `Effect.gen`, the body's effect type is not captured: its error
   * channel is erased to `any` and its requirements are fixed to
   * `JSXRequirements | Scope`, so the result is always `Component<P>`. The
   * yielded-effect type is therefore a bare constraint — no second type
   * parameter — which keeps `P` as the only explicit argument (TypeScript has no
   * partial type-argument inference, so a second inferred param would force the
   * caller to spell out both).
   *
   * @example
   * ```tsx
   * const Greeting = Component.gen<{ name: string }>(function* (props) {
   *   const name = yield* props.name.get;
   *   return <div>Hello, {name}</div>;
   * });
   * ```
   */
  export declare function gen<P>(
    body: (
      props: Reactive<P>,
    ) => Generator<
      YieldWrap<Effect.Effect<any, any, JSXRequirements | Scope.Scope>>,
      JSXNode,
      never
    >,
  ): Component<P>;
}
