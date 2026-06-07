import { Cause, type Effect, Option, type Schema, type Subscribable } from "effect";
import type { Rpc } from "@effect/rpc";
import { elementNode } from "~/combinator/descriptor";
import type { Renderable, ChildrenE, ChildrenR, Node } from "~/combinator/types";

export { AppRpcClientTag } from "./rpc-client";
export type { AppRpcClient } from "./rpc-client";

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
 * Every `Boundary.rpc` embeds this symbol as `type` in the returned descriptor.
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
   * Reactive handle handed to a {@link rpc} boundary's `render`. After
   * hydrate the region is no longer inert: `value` is seeded with the SSR
   * payload and the client can {@link Resource.refetch} the same data on demand,
   * patching the rendered subtree in place via the renderer's existing
   * reactive-child machinery.
   *
   * On the **server** and on the **first client paint after hydrate** `value`
   * emits the SSR `data` first (await-first), so SSR HTML and the adopted DOM are
   * byte-identical — no fallback flash.
   *
   * @typeParam A - The loaded data shape.
   */
  export interface Resource<A> {
    /**
     * The current data. Seeded with the SSR `data`; a successful refetch pushes
     * the new value here so the subtree patches in place.
     */
    readonly value: Subscribable.Subscribable<A>;
    /**
     * Triggers an rpc-backed reload (client only; a no-op on the server). Calls
     * {@link AppRpcClient.call} with the boundary's rpc `tag` and a fresh
     * `payload()`, then sets {@link Resource.value} with the decoded success.
     */
    readonly refetch: Effect.Effect<void>;
    /** `true` while a refetch is in flight (`false` on the server / before any refetch). */
    readonly pending: Subscribable.Subscribable<boolean>;
    /**
     * `Some` with the last refetch error, else `None`. A failed refetch leaves
     * the previous `value` intact (stale-on-error) — it does **not** unmount the
     * subtree or raise into an enclosing failure `Boundary`.
     */
    readonly error: Subscribable.Subscribable<Option.Option<unknown>>;
  }

  /**
   * Options for the {@link rpc} boundary.
   */
  export interface RpcOptions {
    /**
     * Shown between the boundary's comment markers while a **client-first** mount
     * (no SSR payload present) resolves the rpc. Unused on the SSR/hydrate path,
     * where the seeded payload renders directly with no fallback flash. Pass
     * `null` or omit to render nothing while pending.
     */
    readonly fallback?: Renderable;
  }

  /**
   * Creates an rpc-backed server render boundary.
   *
   * The boundary is a thin consumer of one `Rpc` from the application's merged
   * `RpcGroup`. Its data source is the ambient {@link AppRpcClient}: there is no
   * co-located `load`, no `provide`, no per-boundary `id`/registry — the rpc
   * **tag** is the stable identity and the rpc **payload schema** is the typed
   * input. The handler lives in the server-only rpc Layer, so nothing here needs a
   * bundler prune.
   *
   * - **SSR**: the server renderer calls `AppRpcClient.call(tag, payload())`
   *   (an in-process client over the handler Layer), encodes the success through
   *   the rpc's `successSchema` inline as a `<script type="application/json">`
   *   payload, and renders `render(seededResource)` to HTML in place.
   * - **Hydrate**: reads the inline payload at the cursor, decodes via
   *   `successSchema`, seeds the {@link Resource}, and adopts the DOM — replaying
   *   the server result, never re-calling the rpc.
   * - **Refetch**: `Resource.refetch` calls `AppRpcClient.call(tag, payload())`
   *   over the network and patches the subtree in place (stale-on-error).
   * - **Client-first mount** (SPA navigation, no SSR payload): renders `fallback`,
   *   forks an `AppRpcClient.call(tag, payload())`, then swaps in
   *   `render(resource)` once it resolves.
   *
   * `payload` is a thunk so a fresh payload is produced per call (SSR, refetch,
   * mount) — its return type is the rpc's decoded payload. The renderer identifies
   * the boundary via its {@link SERVER_BOUNDARY} type tag.
   *
   * @example
   * ```ts
   * import { Boundary, h } from "@effect-ui/core";
   * import { Rpc, RpcGroup } from "@effect/rpc";
   * import { Schema } from "effect";
   *
   * const StockRpcs = RpcGroup.make(
   *   Rpc.make("GetStock", { payload: { id: Schema.String }, success: Stock }),
   * );
   *
   * Boundary.rpc(
   *   StockRpcs.requests.GetStock,
   *   () => ({ id: product.id }),
   *   (resource) => h.div({}, resource.value),
   *   { fallback: h.div({}, "Loading stock…") },
   * )
   * ```
   */
  export function rpc<R extends Rpc.Any, C extends Node<any, any>>(
    rpc: R,
    payload: () => Rpc.Payload<R>,
    render: (resource: Resource<Rpc.Success<R>>) => C,
    options?: RpcOptions,
  ): Node<Node.Error<C> | Rpc.Error<R>, Node.Context<C>> {
    // The rpc instance carries its tag + schemas; the renderer reads `tag` to call
    // the ambient AppRpcClient and `successSchema`/`errorSchema` to decode the
    // inline SSR payload / refetch result. `payload` stays a thunk so each call
    // (SSR, refetch, mount) gets a fresh value.
    const props = rpc as unknown as {
      readonly _tag: string;
      readonly payloadSchema: Schema.Schema<any, any>;
      readonly successSchema: Schema.Schema<any, any>;
      readonly errorSchema: Schema.Schema<any, any>;
    };
    // Tag the descriptor with SERVER_BOUNDARY so the renderer processes it
    // synchronously via the {type, props} branch.
    return elementNode({
      type: SERVER_BOUNDARY,
      props: {
        tag: props._tag,
        payloadSchema: props.payloadSchema,
        successSchema: props.successSchema,
        errorSchema: props.errorSchema,
        payload,
        render,
        fallback: options?.fallback,
      } as Record<string, unknown>,
    });
  }
}
