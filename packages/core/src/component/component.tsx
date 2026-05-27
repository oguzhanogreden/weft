import { Data, Effect, Subscribable } from "effect";
import type { Scope } from "effect";
import type { YieldWrap } from "effect/Utils";
import type { JSXNode, JSXRequirements } from "~/types";
import { Source } from "~/source";

// Re-exported reliable guard, keyed off Subscribable's TypeId.
export { isSubscribable } from "effect/Subscribable";

/**
 * The inside (author-facing) view of props: every declared slot becomes a
 * read-only `Subscribable` handle exposing `.changes` (live stream) and `.get`
 * (await-first current value). `children` is exempt — it passes through with its
 * declared type so reactive children flow via `JSXNode`'s own arms and
 * render-prop/headless patterns keep their raw callable shape.
 */
export type Subscribables<P> = {
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
  [K in keyof P]: K extends "children" ? P[K] : Source.Source<P[K]>;
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
 * Normalizes all raw props into `Reactive<P>`: children pass through, every
 * other slot is wrapped via `toSubscribable`.
 */
function normalizeProps<P>(
  rawProps: PropsIn<P>,
): Effect.Effect<Subscribables<P>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(rawProps as Record<string, unknown>)) {
      if (key === "children") {
        result[key] = (rawProps as Record<string, unknown>)[key];
      } else {
        const value = (rawProps as Record<string, unknown>)[key];
        result[key] = yield* Source.toSubscribable(value as Source.Source<unknown>, key);
      }
    }
    return result as Subscribables<P>;
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
      props: Subscribables<P>,
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
