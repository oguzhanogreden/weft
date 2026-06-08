import type { Component, Node } from "@weftui/core";
import type { Schema } from "effect";
import type { Router } from "./router-service";

/** Record of field name → `Schema` used for path-param and query schemas. */
export type Fields = Schema.Struct.Fields;

/** Decoded value of a {@link Fields} record (the `Type` side of its `Schema.Struct`). */
export type FieldsType<F extends Fields> = Schema.Struct.Type<F>;

/**
 * The handler-arg props a leaf `component` may declare: the live match's decoded
 * path params and query, derived from the route's `path` / `query` {@link Fields}.
 * The router passes `{ path, query }` into the leaf slot at render time (the
 * {@link makeRoute} props-form overload), so a page can read them directly as props
 * instead of via the `Router.params` / `Router.query` dependency-injection
 * accessors. Layouts and deeper nodes — which can't take handler args — keep DI.
 */
export interface RouteHandlerProps<Path extends Fields = {}, Query extends Fields = {}> {
  /** The live match's decoded path params (`Type` side of the route's `path`). */
  readonly path: FieldsType<Path>;
  /** The live match's decoded query (`Type` side of the route's `query`). */
  readonly query: FieldsType<Query>;
}

/**
 * The shape of a route/layout `component` slot: a callable producing a {@link Node},
 * invoked by the router at render time. It accepts both a plain zero-arg thunk
 * (`() => h.div(…)`) and a {@link Component} produced by `Component.make` /
 * `Component.gen` (a generic `(props, children?) => Node`). The `props: any` arm —
 * rather than `()` — is what keeps a required-props `Component<…>` structurally
 * assignable; the router calls the slot with no arguments.
 */
export type ComponentSlot<N extends Node<any, any> = Node<any, any>> = (props: any) => N;

/**
 * The {@link Node} a {@link ComponentSlot} produces when the router invokes it with no
 * props/children — used to recover the slot's `E`/`R` channels for the route tree.
 *
 * A plain zero-arg thunk is matched first (`() => infer N`): a required-props
 * `Component` is *not* assignable to `() => unknown`, so it falls through to the
 * `Component` arm, where the internal `E`/`R` type parameters are read directly. This
 * two-step form is deliberate — `ReturnType<S>` collapses a generic `Component`'s
 * channels to `unknown` (they depend on the erased `GenP`/`GenC`), whereas extracting
 * the `Component<…, E, R>` parameters preserves them. Caller prop/children channels are
 * never relevant here because the router supplies neither.
 */
export type SlotNode<S> = S extends () => infer N
  ? N
  : S extends Component.Component<any, any, infer E, infer R>
    ? Node<E, R>
    : never;

/**
 * A leaf page in the route tree. Its `component` *is* its handler — a
 * {@link ComponentSlot} (a `Component.gen` / `Component.make` component, or a plain
 * `() => Node` thunk) that the router invokes at render time and that reads the live
 * match's params via `Router.params` / `Router.query`. `Path`/`Query` drive matching
 * and `href`; `E`/`R` are phantom markers carrying the node's channels (recovered via
 * {@link SlotNode}) so they propagate up the tree. The callable slot defers
 * construction (so `href(…)` runs after compile) and mirrors the `notFound` slot.
 */
export interface RouteNode<
  Path extends Fields = {},
  Query extends Fields = {},
  E = never,
  R = never,
> {
  readonly _tag: "Route";
  readonly segment: string;
  readonly path: Path;
  readonly query: Query;
  readonly component: ComponentSlot;
  /** Phantom marker for this leaf's error channel (see {@link TreeE}). */
  readonly _E?: E;
  /** Phantom marker for this leaf's requirement channel (see {@link TreeR}). */
  readonly _R?: R;
}

/**
 * A layout wrapping an outlet (the next level down) in the route tree. A layout is
 * **purely UI nesting** — it owns **no path or segment**; all path structure lives
 * on routes. Its `component` is a {@link ComponentSlot} that splices the injected
 * outlet via `yield* Router.Outlet`; the router invokes it per render and discharges
 * that `Outlet` requirement. A layout that needs a param reads it via `Router.params`.
 * `E`/`R` are the aggregate channels of this layout's `component` (with `Outlet`
 * excluded) together with its whole subtree, so a sealed tree's channels are
 * recoverable from the root.
 */
export interface LayoutNode<E = never, R = never> {
  readonly _tag: "Layout";
  readonly component: ComponentSlot;
  readonly children: readonly TreeNode[];
  /**
   * Phantom marker for this layout subtree's aggregate error channel (see
   * {@link TreeE}). Covariant (stores `E` directly) so a fully-discharged layout
   * (`LayoutNode<never, never>` — its `Outlet` provided, no subtree errors) stays
   * assignable to the `LayoutNode<any, any>` arm of {@link TreeNode}.
   */
  readonly _E?: E;
  /** Phantom marker for this layout subtree's aggregate requirement channel (see {@link TreeR}). */
  readonly _R?: R;
}

/** Any node in the route tree. */
export type TreeNode = RouteNode<any, any, any, any> | LayoutNode<any, any>;

/** Extracts the error channel from a single {@link TreeNode}. */
export type TreeE<T> =
  T extends RouteNode<any, any, infer E, any> ? E : T extends LayoutNode<infer E, any> ? E : never;

/** Extracts the requirement channel from a single {@link TreeNode}. */
export type TreeR<T> =
  T extends RouteNode<any, any, any, infer R> ? R : T extends LayoutNode<any, infer R> ? R : never;

/** Aggregate error channel over a children tuple (distributes over `C[number]`). */
export type SubtreeE<C extends readonly TreeNode[]> = TreeE<C[number]>;

/** Aggregate requirement channel over a children tuple (distributes over `C[number]`). */
export type SubtreeR<C extends readonly TreeNode[]> = TreeR<C[number]>;

/**
 * Declares a leaf page. The `component` *is* the route handler — a thunk the
 * router invokes at render time; its error / requirement channels propagate up the
 * tree. Two authoring forms are accepted:
 *
 * - **Handler-arg props** — the slot declares `(props: {@link RouteHandlerProps})`
 *   and the router passes the live match's decoded `{ path, query }` in directly
 *   (first overload; `path`/`query` are inferred from the route's `path`/`query`
 *   fields). A plain zero-arg thunk works too — it just ignores the props.
 * - **Dependency injection** — a `Component.make` / `Component.gen` component that
 *   reads the live match via `Router.params` / `Router.query` (second overload).
 *
 * @example Handler-arg props (decoded `{ path, query }`)
 * ```ts
 * Router.route("users/:id", {
 *   path: { id: Schema.NumberFromString },
 *   query: { tab: Schema.optional(Schema.String) },
 *   component: ({ path, query }) => h.div({}, `User ${path.id} (${query.tab ?? "info"})`),
 * });
 * ```
 *
 * @example Dependency injection (`Router.params` / a `Component`)
 * ```ts
 * Router.route("about", { component: Component.make(() => h.h1({}, "About")) });
 * Router.route("users/:id", {
 *   path: { id: Schema.NumberFromString },
 *   component: Component.gen(function* () {
 *     const { id } = yield* Router.params({ id: Schema.NumberFromString });
 *     return yield* h.div({}, `User ${id}`);
 *   }),
 * });
 * ```
 */
export function makeRoute<
  Path extends Fields = {},
  Query extends Fields = {},
  E = never,
  R = never,
>(
  segment: string,
  config: {
    readonly path?: Path;
    readonly query?: Query;
    readonly component: (props: RouteHandlerProps<Path, Query>) => Node<E, R>;
  },
): RouteNode<Path, Query, E, R>;
export function makeRoute<
  Path extends Fields = {},
  Query extends Fields = {},
  S extends ComponentSlot = ComponentSlot,
>(
  segment: string,
  config: {
    readonly path?: Path;
    readonly query?: Query;
    readonly component: S;
  },
): RouteNode<Path, Query, Node.Error<SlotNode<S>>, Node.Context<SlotNode<S>>>;
export function makeRoute(
  segment: string,
  config: {
    readonly path?: Fields;
    readonly query?: Fields;
    readonly component: ComponentSlot;
  },
): RouteNode<any, any, any, any> {
  return {
    _tag: "Route",
    segment,
    path: config.path ?? {},
    query: config.query ?? {},
    component: config.component,
  };
}

/**
 * Declares a layout. `component` is a {@link ComponentSlot} that splices the next
 * level down via `yield* Router.Outlet` (place it in the returned tree). The
 * router invokes it per render and provides that outlet, so `Router.Outlet` is
 * **excluded** from the layout's aggregate requirement channel; the subtree's
 * real channels are unioned in.
 *
 * @example
 * ```ts
 * Router.layout(
 *   {
 *     component: Component.gen(function* () {
 *       const outlet = yield* Router.Outlet;
 *       return yield* h.div({ class: "shell" }, [Header(), outlet]);
 *     }),
 *   },
 *   [Router.route("", { component: Home })],
 * );
 * ```
 */
export function makeLayout<C extends readonly TreeNode[], S extends ComponentSlot = ComponentSlot>(
  config: { readonly component: S },
  children: C,
): LayoutNode<
  Node.Error<SlotNode<S>> | SubtreeE<C>,
  Exclude<Node.Context<SlotNode<S>>, Router.Outlet> | SubtreeR<C>
> {
  return {
    _tag: "Layout",
    component: config.component,
    children,
  };
}
