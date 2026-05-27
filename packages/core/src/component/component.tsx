import {
  Data,
  Deferred,
  Effect,
  Option,
  Stream,
  Subscribable,
  SubscriptionRef,
  pipe,
} from "effect";
import type { Scope } from "effect";
import type { YieldWrap } from "effect/Utils";
import type { JSXNode, JSXRequirements, Source } from "~/types";
import { isStream } from "~/stream";

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
 *
 * The error channel is `never`: the body's errors are erased at the component
 * boundary (unhandled body errors surface as fiber failures — the seam a future
 * error boundary plugs into). This keeps the JSX element type valid since
 * `JSXNode`'s Effect arm uses `never` for errors.
 */
export interface Component<P> {
  (props: PropsIn<P>): Effect.Effect<JSXNode, never, JSXRequirements | Scope.Scope>;
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
 *
 * @param source - The caller-supplied prop value.
 * @param key - Optional prop key carried on `NoPropValue` for diagnostics.
 */
export function toSubscribable<A>(
  source: Source<A>,
  key?: string,
): Effect.Effect<Subscribable.Subscribable<A, NoPropValue>, never, Scope.Scope> {
  // Identity: already a Subscribable — return by reference, no new ref/fiber.
  if (Subscribable.isSubscribable(source)) {
    return Effect.succeed(source as unknown as Subscribable.Subscribable<A, NoPropValue>);
  }

  // Stream: hot/shared pump via SubscriptionRef + first-value latch.
  if (isStream(source)) {
    return Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make(Option.none<A>());
      const latch = yield* Deferred.make<A, NoPropValue>();

      // Pump: drain source into ref and resolve the first-value latch.
      const pump = pipe(
        Stream.runForEach(source as Stream.Stream<A>, (value) =>
          pipe(
            SubscriptionRef.set(ref, Option.some(value)),
            Effect.zipRight(Deferred.succeed(latch, value)),
            Effect.asVoid,
          ),
        ),
        // On completion: if no value was ever emitted, fail the latch.
        Effect.ensuring(
          pipe(
            SubscriptionRef.get(ref),
            Effect.flatMap((opt) =>
              Option.isNone(opt)
                ? Effect.asVoid(Deferred.fail(latch, new NoPropValue({ key })))
                : Effect.void,
            ),
          ),
        ),
      );

      // Fork pump into the enclosing scope — dies when the instance scope closes.
      yield* Effect.forkScoped(pump);

      // get: return latest if available; otherwise await the first emission.
      const get: Effect.Effect<A, NoPropValue> = pipe(
        SubscriptionRef.get(ref),
        Effect.flatMap((opt) =>
          Option.isSome(opt) ? Effect.succeed(opt.value) : Deferred.await(latch),
        ),
      );

      // changes: filter the SubscriptionRef's broadcast stream to present values.
      const changes: Stream.Stream<A, NoPropValue> = pipe(
        ref.changes,
        Stream.filterMap((opt) => opt),
      ) as Stream.Stream<A, NoPropValue>;

      return Subscribable.make({ get, changes });
    }) as Effect.Effect<Subscribable.Subscribable<A, NoPropValue>, never, Scope.Scope>;
  }

  // Effect: memoize so the source runs at most once across all consumers.
  if (Effect.isEffect(source)) {
    return Effect.gen(function* () {
      const memoized = yield* Effect.cached(source as Effect.Effect<A, never, never>);
      const get = memoized as Effect.Effect<A, NoPropValue>;
      const changes = Stream.fromEffect(memoized) as Stream.Stream<A, NoPropValue>;
      return Subscribable.make({ get, changes });
    }) as Effect.Effect<Subscribable.Subscribable<A, NoPropValue>, never, Scope.Scope>;
  }

  // Static value: succeed immediately, emit once, no fiber.
  const value = source as A;
  return Effect.succeed(
    Subscribable.make({
      get: Effect.succeed(value) as Effect.Effect<A, NoPropValue>,
      changes: Stream.make(value) as Stream.Stream<A, NoPropValue>,
    }),
  ) as Effect.Effect<Subscribable.Subscribable<A, NoPropValue>, never, Scope.Scope>;
}

/**
 * Normalizes all raw props into `Reactive<P>`: children pass through, every
 * other slot is wrapped via `toSubscribable`.
 */
function normalizeProps<P>(rawProps: PropsIn<P>): Effect.Effect<Reactive<P>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(rawProps as Record<string, unknown>)) {
      if (key === "children") {
        result[key] = (rawProps as Record<string, unknown>)[key];
      } else {
        const value = (rawProps as Record<string, unknown>)[key];
        result[key] = yield* toSubscribable(value as Source<unknown>, key);
      }
    }
    return result as Reactive<P>;
  });
}

export namespace Component {
  /**
   * Define a component from an `Effect.gen`-style generator body. `P` is the raw
   * prop shape, written once as the sole type argument; the body receives it
   * mapped to `Reactive<P>` and `return`s the `JSXNode`.
   *
   * Unlike `Effect.gen`, the body's effect type is not captured: its error
   * channel is erased (body errors become fiber failures, not typed errors) and
   * its requirements are fixed to `JSXRequirements | Scope`, so the result is
   * always `Component<P>`. The yielded-effect type is therefore a bare
   * constraint — no second type parameter — which keeps `P` as the only
   * explicit argument (TypeScript has no partial type-argument inference, so a
   * second inferred param would force the caller to spell out both).
   *
   * @example
   * ```tsx
   * const Greeting = Component.gen<{ name: string }>(function* (props) {
   *   const name = yield* props.name.get;
   *   return <div>Hello, {name}</div>;
   * });
   * ```
   */
  export function gen<P>(
    body: (
      props: Reactive<P>,
    ) => Generator<
      YieldWrap<Effect.Effect<any, any, JSXRequirements | Scope.Scope>>,
      JSXNode,
      never
    >,
  ): Component<P> {
    return ((rawProps: PropsIn<P>): Effect.Effect<JSXNode, never, JSXRequirements | Scope.Scope> =>
      Effect.gen(function* () {
        const props = yield* normalizeProps<P>(rawProps);
        // Wrap body in Effect.gen to avoid generator-delegation TNext mismatch.
        // Cast error channel to never: body errors become fiber failures, not
        // typed errors on the Component's call signature.
        return yield* Effect.gen(() => body(props)) as Effect.Effect<
          JSXNode,
          never,
          JSXRequirements | Scope.Scope
        >;
      })) as Component<P>;
  }
}
