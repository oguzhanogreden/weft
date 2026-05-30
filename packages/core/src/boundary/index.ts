import { Cause, Effect, Option } from "effect";
import type { RenderNode } from "~/types";
import type { Child, ChildrenE, ChildrenR, Node } from "~/combinator/types";

/**
 * Unique type tag used by renderers to identify a `Boundary` descriptor.
 * All six variants embed this symbol as `type` in the returned descriptor.
 */
// oxlint-disable-next-line typescript/no-explicit-any
export const BOUNDARY: unique symbol = Symbol.for("effect-ui/BOUNDARY") as any;

/**
 * Internal descriptor props shared by all `Boundary.*` variants.
 * The renderer reads `match` to decide how to handle a caught error.
 */
export interface BoundaryProps {
  /**
   * Called with the caught `Cause`. Returns a fallback `Node` if this boundary
   * handles the error, or `null` to re-raise to a parent boundary.
   */
  readonly match: (cause: Cause.Cause<unknown>) => Node<unknown, unknown> | null;
  readonly children: readonly RenderNode[];
}

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

function makeBoundaryNode<E, R>(
  match: (cause: Cause.Cause<unknown>) => Node<unknown, unknown> | null,
  children: readonly Child[],
): Node<E, R> {
  return Effect.succeed({
    type: BOUNDARY,
    props: { match, children } as Record<string, unknown>,
  }) as Node<E, R>;
}

/**
 * Error boundary namespace. Each variant wraps a subtree and intercepts
 * rendering-path errors (construction-time and post-mount stream failures).
 *
 * All variants return a plain `{ type: BOUNDARY, props }` descriptor — the
 * renderer detects it synchronously via the `{ type, props }` branch, the
 * same path as `Suspense`.
 *
 * @example
 * ```ts
 * import { Boundary } from "@effect-ui/core";
 *
 * Boundary.catchAll({ fallback: (e) => h.div({}, e.message) }, [child])
 * ```
 */
export namespace Boundary {
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
    return makeBoundaryNode(match, children);
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
    return makeBoundaryNode(match, children);
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
    return makeBoundaryNode(match, children);
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
    return makeBoundaryNode(match, children);
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
    return makeBoundaryNode(match, children);
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
    return makeBoundaryNode(match, children);
  }
}
