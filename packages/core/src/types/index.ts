import type { Effect, Stream, Subscribable } from "effect";
import type { FRAGMENT } from "~/jsx-runtime";

declare global {
  namespace JSX {
    /**
     * Augment this interface with your app's Effect context requirements.
     *
     * @example
     * ```ts
     * declare global {
     *   namespace JSX {
     *     interface Requirements {
     *       _: Context.Tag.Service<typeof MyServiceTag>;
     *     }
     *   }
     * }
     * ```
     */
    interface Requirements {}
  }
}

/**
 * Computes JSX context requirements from the augmented JSX.Requirements interface.
 * - When empty (not augmented): defaults to `any` to accept all streams/effects
 * - When augmented: union of all registered service types
 */
export type JSXRequirements = keyof JSX.Requirements extends never
  ? any
  : JSX.Requirements[keyof JSX.Requirements];

export type JSXNode =
  | void
  | null
  | undefined
  | string
  | number
  | bigint
  | boolean
  | Iterable<JSXNode>
  | Stream.Stream<JSXNode, never, JSXRequirements>
  | Effect.Effect<JSXNode, never, JSXRequirements>
  | { type: JSXType; props: Record<string, unknown> };

export type JSXType = typeof FRAGMENT | string | ((props: Record<string, unknown>) => JSXNode);

/**
 * The caller-facing prop vocabulary: a slot typed `MaybeReactive<T>` accepts a
 * static value, a `Stream`, an `Effect`, or an existing `Subscribable`, and the
 * caller can switch between them freely. An incoming `Subscribable` is threaded
 * through by reference (no re-wrap); the rest normalize via `toSubscribable`
 * from `@effect-ui/core`.
 */
export type MaybeReactive<T> =
  | T
  | Stream.Stream<T>
  | Effect.Effect<T>
  | Subscribable.Subscribable<T>;

export * from "./html/aria";
export * from "./html/attributes";
export * from "./html/dom";
export * from "./html/html";
export * from "./html/svg";
