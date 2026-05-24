import { Context, Data, ManagedRuntime, Scope } from "effect";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when JSXNode has invalid type (not string, FRAGMENT, or function)
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
 * Service for managing rendering context including runtime, scope, and stream IDs
 */

export class RenderContext extends Context.Tag("RenderContext")<
  RenderContext,
  {
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
    readonly scope: Scope.Scope;
    readonly streamIdCounter: { current: number };
  }
>() {}
