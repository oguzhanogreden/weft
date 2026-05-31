import { Cause, Context, Data, Effect, ManagedRuntime, Scope } from "effect";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when Renderable has invalid type (not string, FRAGMENT, or function)
 */
export class UnsupportedNodeTypeError extends Data.TaggedError("UnsupportedNodeTypeError")<{
  readonly type: unknown;
  readonly message: string;
}> {}
/**
 * Error thrown when stream subscription or execution fails
 */

export class StreamSubscriptionError extends Data.TaggedError("StreamSubscriptionError")<{
  readonly cause: unknown;
  readonly context: string;
}> {}
/**
 * Error thrown for general rendering failures
 */

export class RenderError extends Data.TaggedError("RenderError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}
/**
 * Error thrown when the existing DOM does not match the JSX tree during
 * hydration (e.g. expected a text node but found an element, mismatched tag
 * name, or a missing reactive-region marker).
 */

export class HydrationMismatchError extends Data.TaggedError("HydrationMismatchError")<{
  readonly expected: string;
  readonly actual: string;
  readonly path: string;
}> {}

/**
 * Optional service provided by a `Boundary.*` descriptor to its subtree.
 *
 * Stream fibers running inside the boundary call `reportError` when they fail.
 * Inner boundaries shadow the outer service via `Effect.provideService`, so
 * errors are always reported to the innermost enclosing boundary.
 */
export class BoundaryContext extends Context.Tag("BoundaryContext")<
  BoundaryContext,
  {
    /** Report a rendering-path error to this boundary. */
    readonly reportError: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
  }
>() {}

/**
 * Optional service provided by a suspense boundary (`Boundary.suspend`) to its
 * subtree.
 *
 * Function components returning `Effect`/`Stream` call `register` before their
 * stream is subscribed and `settle` exactly once when the stream emits its first
 * value. The boundary waits until all registered children have settled before
 * swapping the fallback for the resolved content.
 *
 * Inner suspense boundaries shadow the outer service for their own subtree
 * via `Effect.provideService`, so children register with the innermost boundary.
 */
export class SuspenseContext extends Context.Tag("SuspenseContext")<
  SuspenseContext,
  {
    /** Increment the boundary's pending count. */
    readonly register: Effect.Effect<void>;
    /** Decrement the pending count; triggers the swap when it reaches zero. */
    readonly settle: Effect.Effect<void>;
  }
>() {}

/**
 * The value produced by rendering a single Renderable: a single DOM node, an
 * ordered list of nodes (e.g. for a fragment or array child), or nothing.
 *
 * Defined here so both `render-core.ts` and `suspense.ts` can reference it
 * without a circular import.
 */
export type RenderResult = Node | readonly Node[] | null;

/**
 * Service for managing rendering context including runtime, scope, and stream IDs
 */

export class RenderContext extends Context.Tag("RenderContext")<
  RenderContext,
  {
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
    /**
     * The current enclosing reactive scope. All forked fibers and prop pumps
     * within this region are children of this scope. Provided alongside the
     * ambient `Scope.Scope` service at every scope boundary — the two always
     * point at the same scope.
     */
    readonly scope: Scope.Scope;
    readonly streamIdCounter: { current: number };
  }
>() {}
