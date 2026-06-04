import { Cause, type Effect, Layer, Option, type Schema } from "effect";
import { elementNode } from "~/combinator/descriptor";
import type { Renderable, ChildrenE, ChildrenR, Node } from "~/combinator/types";

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

/**
 * Unique type tag used by renderers to identify a server `Boundary` descriptor.
 * Every `Boundary.server` embeds this symbol as `type` in the returned descriptor.
 */
export const SERVER_BOUNDARY: unique symbol = Symbol.for("effect-ui/SERVER_BOUNDARY");

/** Remove a single tagged error from the children's error union. */
export type CatchTagE<C extends readonly Renderable[], Tag extends string> = Exclude<
  ChildrenE<C>,
  { _tag: Tag }
>;

/** Remove multiple tagged errors from the children's error union. */
export type CatchTagsE<C extends readonly Renderable[], Tags extends string> = Exclude<
  ChildrenE<C>,
  { _tag: Tags }
>;

function makeFailureBoundaryNode<E, R>(
  match: (cause: Cause.Cause<unknown>) => Node<unknown, unknown> | null,
  children: readonly Renderable[],
): Node<E, R> {
  return elementNode<E, R>({
    type: FAILURE_BOUNDARY,
    props: { match, children } as Record<string, unknown>,
  });
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
    readonly fallback?: Renderable;
  }

  /**
   * Catch all typed failures (not defects). The children's `E` is fully
   * consumed; the output `E` is only the fallback's error channel.
   */
  export function catchAll<C extends readonly Renderable[], FE = never, FR = never>(
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
  export function catchAllCause<C extends readonly Renderable[], FE = never, FR = never>(
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
    C extends readonly Renderable[],
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
    C extends readonly Renderable[],
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
  export function catchSome<C extends readonly Renderable[], FE = never, FR = never>(
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
  export function catchIf<C extends readonly Renderable[], FE = never, FR = never>(
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
  export function suspend<C extends readonly Renderable[]>(
    props: SuspenseProps,
    children: C,
  ): Node<ChildrenE<C>, ChildrenR<C>> {
    // Tag the descriptor with SUSPENSE_BOUNDARY so the renderer processes it
    // synchronously via the {type, props} branch.
    return elementNode({
      type: SUSPENSE_BOUNDARY,
      props: { ...props, children },
    });
  }

  /**
   * Props for the {@link server} boundary — read by the server renderer to run
   * `load`, by both renderers to encode/decode through `schema`, and (via
   * `render`) to build the subtree from the loaded data.
   *
   * @typeParam A - The loaded data shape, shared by `load`, `schema`, and `render`.
   * @typeParam ELoad - Typed failures `load` may produce (server-side only in v1).
   * @typeParam RServer - Server-only requirements of `load`, discharged by `provide`.
   */
  export interface ServerProps<A, ELoad, RServer> {
    /**
     * Thunk producing the server `load` effect. Deferred so it is constructed and
     * run **only on the server** — never during client `hydrate`.
     */
    readonly load: () => Effect.Effect<A, ELoad, RServer>;
    /**
     * Discharges `load`'s server-only requirements `RServer` at construction: the
     * structural guarantee that no un-discharged server dependency escapes into
     * the boundary's requirement channel `R`. **Required whenever `load` has
     * requirements (`RServer ≠ never`)** — enforced on the {@link server}
     * signature — and **omittable when `RServer` is `never`** (it defaults to
     * `Layer.empty`, so a dependency-free `load` need not pass `provide`).
     */
    readonly provide?: Layer.Layer<RServer>;
    /**
     * Wire contract for `A`: `Schema.encode`d to JSON on the server (emitted
     * inline) and `Schema.decode`d from that JSON on the client during `hydrate`.
     */
    readonly schema: Schema.Schema<A, any>;
    /**
     * Wire contract for a `load` **failure**: a typed `ELoad` error is
     * `Schema.encode`d on the server (into the inline failure payload) and
     * `Schema.decode`d + re-raised on the client during `hydrate`, so the same
     * enclosing failure `Boundary` reproduces the same fallback. **Required when
     * `ELoad ≠ never`** (enforced on the {@link server} signature); omittable when
     * `load` cannot fail. Replays the failure, never retries `load`.
     */
    readonly failure?: Schema.Schema<ELoad, any>;
  }

  /**
   * Creates a server render boundary.
   *
   * On the server, the renderer runs `Effect.provide(load(), provide)` to obtain
   * `data: A` (blocking on it), encodes it through `schema` and emits the result
   * inline as a `<script type="application/json">` payload (hydratable pass only),
   * then renders `render(data)` to HTML in place. On the client, `hydrate` **does
   * not run `load`**: it reads the inline payload at the cursor, decodes it through
   * `schema`, and hydrates `render(data)` against the adopted DOM — replaying the
   * server result, never retrying.
   *
   * `provide` discharges `load`'s server-only requirements `RServer`, so they
   * never enter the output requirement channel `R` (which is exactly `render`'s
   * `R`, untouched — no `Exclude`). `ELoad` remains in the output error channel.
   * A typed `load` failure is **replayed on the client**: the server encodes it
   * via `failure` into the inline payload and the client `hydrate` decodes it and
   * re-raises it into the nearest enclosing failure `Boundary`, reproducing the
   * same fallback DOM (replay, never retry). `failure` is therefore **required
   * when `ELoad ≠ never`** and omittable when `load` cannot fail. A `load`
   * **defect** (not an expected `ELoad`) is not replayed: it propagates as today
   * (server fallback, client hydration mismatch).
   *
   * The renderer identifies the boundary via its {@link SERVER_BOUNDARY} type tag.
   *
   * @example
   * ```ts
   * import { Boundary, h } from "@effect-ui/core";
   * import { Layer, Schema } from "effect";
   *
   * Boundary.server(
   *   {
   *     load: () => Database.query(),
   *     provide: DatabaseLive,
   *     schema: Product,
   *   },
   *   (product) => h.div({}, product.name),
   * )
   * ```
   */
  export function server<A, ELoad, RServer, C extends Node<any, any>>(
    props: ServerProps<A, ELoad, RServer> &
      ([ELoad] extends [never] ? unknown : { readonly failure: Schema.Schema<ELoad, any> }) &
      ([RServer] extends [never] ? unknown : { readonly provide: Layer.Layer<RServer> }),
    render: (data: A) => C,
  ): Node<Node.Error<C> | ELoad, Node.Context<C>> {
    // Tag the descriptor with SERVER_BOUNDARY so the renderer processes it
    // synchronously via the {type, props} branch. RServer is consumed by
    // `provide`, so it is absent from the returned R; no Exclude is applied to
    // render's R, leaving any accidental server-tag leak visible for hydrate.
    // `provide` is omittable only when `RServer = never` (the signature requires
    // it otherwise), so default it to `Layer.empty` to keep the descriptor's
    // runtime contract — the renderer always `Effect.provide`s a real layer.
    return elementNode({
      type: SERVER_BOUNDARY,
      props: { ...props, provide: props.provide ?? Layer.empty, render } as Record<string, unknown>,
    });
  }
}
