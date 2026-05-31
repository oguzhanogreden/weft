import { Cause, Effect, Option } from "effect";
import type { Child, ChildrenE, ChildrenR, Node } from "~/combinator/types";

/**
 * Unique type tag used by renderers to identify a failure `Boundary` descriptor.
 * All variants embed this symbol as `type` in the returned descriptor.
 */
export const FAILURE_BOUNDARY: unique symbol = Symbol.for("effect-ui/FAILURE_BOUNDARY");

/**
 * Unique type tag used by renderers to identify a suspense `Boundary` descriptor.
 * All `Boundary.suspend` embeds this symbol as `type` in the returned descriptor.
 */
export const SUSPENSE_BOUNDARY: unique symbol = Symbol.for("effect-ui/SUSPENSE_BOUNDARY");

/** Remove a single tagged error from the children's error union. */
export type CatchTagE<C extends readonly Child[], Tag extends string> = Exclude<
  ChildrenE<C>,
  { _tag: Tag }
>;

/** Remove multiple tagged errors from the children's error union. */
export type CatchTagsE<C extends readonly Child[], Tags extends string> = Exclude<
  ChildrenE<C>,
  { _tag: Tags }
>;

function makeFailureBoundaryNode<E, R>(
  match: (cause: Cause.Cause<unknown>) => Node<unknown, unknown> | null,
  children: readonly Child[],
): Node<E, R> {
  return Effect.succeed({
    type: FAILURE_BOUNDARY,
    props: { match, children } as Record<string, unknown>,
  }) as Node<E, R>;
}

/**
 * Boundary namespace encapsulating failure and suspense boundaries. Each
 * variant wraps a subtree and shows a fallback in response to an event.
 *
 * - **Failure boundaries** (`catchAll`, `catchAllCause`, `catchTag`,
 *   `catchTags`, `catchSome`, `catchIf`) intercept rendering-path errors —
 *   construction-time errors and post-mount stream failures — mirroring
 *   Effect's `catch*` combinators.
 * - **Suspense boundary** (`suspend`) shows a fallback while async children are
 *   pending, then swaps to the resolved children once all have settled.
 *
 * Each variant returns a plain `{ type, props }` descriptor tagged with
 * {@link FAILURE_BOUNDARY} or {@link SUSPENSE_BOUNDARY}; the renderer detects it
 * synchronously via the `{ type, props }` branch.
 *
 * @example
 * ```ts
 * import { Boundary, h } from "@effect-ui/core";
 *
 * // Failure boundary wrapping a suspense boundary — the common pairing:
 * Boundary.catchAll({ fallback: (e) => h.div({}, e.message) }, [
 *   Boundary.suspend({ fallback: h.div({}, "Loading…") }, [AsyncCard()]),
 * ])
 * ```
 */
export namespace Boundary {
  /**
   * Internal descriptor props shared by the failure `Boundary.*` variants
   * (everything except {@link suspend}). The renderer reads `match` to decide
   * how to handle a caught error.
   */
  export interface FailureProps {
    /**
     * Called with the caught `Cause`. Returns a fallback `Node` if this boundary
     * handles the error, or `null` to re-raise to a parent boundary.
     */
    readonly match: (cause: Cause.Cause<unknown>) => Node<unknown, unknown> | null;
  }

  /**
   * Props for the {@link suspend} boundary — used by renderers to access
   * `fallback` and `children` from the node descriptor.
   */
  export interface SuspenseProps {
    /**
     * Shown in the DOM while async children are pending. Pass `null` or omit to
     * render nothing (only the comment markers) while pending.
     */
    readonly fallback?: Child;
  }

  /**
   * Catch all typed failures (not defects). The children's `E` is fully
   * consumed; the output `E` is only the fallback's error channel.
   */
  export function catchAll<C extends readonly Child[], FE = never, FR = never>(
    props: { readonly fallback: (e: ChildrenE<C>) => Node<FE, FR> },
    children: C,
  ): Node<FE, ChildrenR<C> | FR> {
    const match = (cause: Cause.Cause<unknown>): Node<unknown, unknown> | null => {
      const opt = Cause.failureOption(cause);
      return Option.isSome(opt) ? props.fallback(opt.value as ChildrenE<C>) : null;
    };
    return makeFailureBoundaryNode(match, children);
  }

  /**
   * Catch all causes including defects and interruptions. The children's `E`
   * is fully consumed; the output `E` is only the fallback's error channel.
   */
  export function catchAllCause<C extends readonly Child[], FE = never, FR = never>(
    props: { readonly fallback: (cause: Cause.Cause<ChildrenE<C>>) => Node<FE, FR> },
    children: C,
  ): Node<FE, ChildrenR<C> | FR> {
    const match = (cause: Cause.Cause<unknown>): Node<unknown, unknown> | null =>
      props.fallback(cause as Cause.Cause<ChildrenE<C>>);
    return makeFailureBoundaryNode(match, children);
  }

  /**
   * Catch errors whose `_tag` matches `props.tag`. The matched tag is removed
   * from the output `E`; unmatched errors are re-raised.
   */
  export function catchTag<
    C extends readonly Child[],
    Tag extends ChildrenE<C> extends { _tag: string } ? ChildrenE<C>["_tag"] : string,
    FE = never,
    FR = never,
  >(
    props: {
      readonly tag: Tag;
      readonly fallback: (e: Extract<ChildrenE<C>, { _tag: Tag }>) => Node<FE, FR>;
    },
    children: C,
  ): Node<CatchTagE<C, Tag> | FE, ChildrenR<C> | FR> {
    const match = (cause: Cause.Cause<unknown>): Node<unknown, unknown> | null => {
      const opt = Cause.failureOption(cause);
      if (Option.isNone(opt)) return null;
      const e = opt.value as { _tag?: string };
      return e._tag === props.tag
        ? props.fallback(e as Extract<ChildrenE<C>, { _tag: Tag }>)
        : null;
    };
    return makeFailureBoundaryNode(match, children);
  }

  /**
   * Catch errors whose `_tag` matches a key in the handlers record. Each
   * matched tag is removed from the output `E`; unmatched errors are re-raised.
   * The handlers record IS the first argument (no wrapping object).
   */
  export function catchTags<
    C extends readonly Child[],
    Handlers extends {
      readonly [Tag in ChildrenE<C> extends { _tag: string } ? ChildrenE<C>["_tag"] : never]?: (
        e: Extract<ChildrenE<C>, { _tag: Tag }>,
      ) => Node<any, any>;
    },
  >(
    handlers: Handlers,
    children: C,
  ): Node<
    | CatchTagsE<C, keyof Handlers & string>
    | {
        [K in keyof Handlers]: Handlers[K] extends (e: any) => Node<infer E, any> ? E : never;
      }[keyof Handlers],
    | ChildrenR<C>
    | {
        [K in keyof Handlers]: Handlers[K] extends (e: any) => Node<any, infer R> ? R : never;
      }[keyof Handlers]
  > {
    const match = (cause: Cause.Cause<unknown>): Node<unknown, unknown> | null => {
      const opt = Cause.failureOption(cause);
      if (Option.isNone(opt)) return null;
      const e = opt.value as { _tag?: string };
      const tag = e._tag;
      if (tag === undefined) return null;
      const handler = (
        handlers as Record<string, ((e: unknown) => Node<unknown, unknown>) | undefined>
      )[tag];
      return handler ? handler(e) : null;
    };
    return makeFailureBoundaryNode(match, children);
  }

  /**
   * Conditionally catch — the fallback returns `Option`. If it returns
   * `Option.none()`, the error is re-raised. The children's `E` is preserved
   * in the output since the boundary may not handle any given error.
   */
  export function catchSome<C extends readonly Child[], FE = never, FR = never>(
    props: { readonly fallback: (e: ChildrenE<C>) => Option.Option<Node<FE, FR>> },
    children: C,
  ): Node<ChildrenE<C> | FE, ChildrenR<C> | FR> {
    const match = (cause: Cause.Cause<unknown>): Node<unknown, unknown> | null => {
      const opt = Cause.failureOption(cause);
      if (Option.isNone(opt)) return null;
      const result = props.fallback(opt.value as ChildrenE<C>);
      return Option.isSome(result) ? (result.value as Node<unknown, unknown>) : null;
    };
    return makeFailureBoundaryNode(match, children);
  }

  /**
   * Conditionally catch — a predicate gates the fallback. If the predicate
   * returns `false`, the error is re-raised. The children's `E` is preserved
   * in the output since the boundary may not handle any given error.
   */
  export function catchIf<C extends readonly Child[], FE = never, FR = never>(
    props: {
      readonly predicate: (e: ChildrenE<C>) => boolean;
      readonly fallback: (e: ChildrenE<C>) => Node<FE, FR>;
    },
    children: C,
  ): Node<ChildrenE<C> | FE, ChildrenR<C> | FR> {
    const match = (cause: Cause.Cause<unknown>): Node<unknown, unknown> | null => {
      const opt = Cause.failureOption(cause);
      if (Option.isNone(opt)) return null;
      const e = opt.value as ChildrenE<C>;
      return props.predicate(e) ? props.fallback(e) : null;
    };
    return makeFailureBoundaryNode(match, children);
  }

  /**
   * Creates a suspense boundary node.
   *
   * Shows `fallback` while async children are pending (have not yet emitted
   * their first value), then atomically swaps to the resolved children once
   * **all** pending children have settled.
   *
   * The renderer (`@effect-ui/dom`) identifies the boundary via its
   * {@link SUSPENSE_BOUNDARY} type tag.
   *
   * @example
   * ```ts
   * import { Boundary, h } from "@effect-ui/core";
   *
   * Boundary.suspend({ fallback: h.div({}, "Loading…") }, [AsyncCard(), AsyncSidebar()])
   * ```
   */
  export function suspend<C extends readonly Child[]>(
    props: SuspenseProps,
    children: C,
  ): Node<ChildrenE<C>, ChildrenR<C>> {
    // Tag the descriptor with SUSPENSE_BOUNDARY so the renderer processes it
    // synchronously via the {type, props} branch.
    return Effect.succeed({
      type: SUSPENSE_BOUNDARY,
      props: { ...props, children },
    });
  }
}
