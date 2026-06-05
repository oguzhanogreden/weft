import type { Node } from "@effect-ui/core";
import type { Schema } from "effect";
import type { RouterNotFound } from "./errors";
import type { Router } from "./router-service";

/** Record of field name → `Schema` used for path-param and query schemas. */
export type Fields = Schema.Struct.Fields;

/** Decoded value of a {@link Fields} record (the `Type` side of its `Schema.Struct`). */
export type FieldsType<F extends Fields> = Schema.Struct.Type<F>;

/**
 * Arguments handed to a leaf page `component`: the decoded path params and query
 * for the current match. Path is the leaf's **own** declared params; the runtime
 * value additionally carries any ancestor params merged down the branch.
 */
export interface RouteArgs<Path extends Fields, Query extends Fields> {
  readonly path: FieldsType<Path>;
  readonly query: FieldsType<Query>;
}

/**
 * Arguments handed to a layout `render`: the decoded path params for the level
 * plus the fully-typed `outlet` (the next level down). The outlet's channels are
 * the union of every descendant's channels, plus the router's own (`Router` is
 * required, a page may raise {@link RouterNotFound}).
 */
export interface LayoutRenderArgs<Path extends Fields, C extends readonly TreeNode[]> {
  readonly path: FieldsType<Path>;
  readonly outlet: Node<SubtreeE<C> | RouterNotFound, SubtreeR<C> | Router>;
}

/**
 * A leaf page in the route tree. Its `component` is its handler. `E`/`R` capture
 * the component node's error / requirement channels so they propagate up the tree.
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
  readonly component: (args: RouteArgs<Path, Query>) => Node<E, R>;
}

/**
 * A layout wrapping an outlet (the next level down) in the route tree. `E`/`R`
 * are the aggregate channels of this layout's `render` together with its whole
 * subtree, so a sealed tree's channels are recoverable from the root.
 */
export interface LayoutNode<Path extends Fields = {}, E = never, R = never> {
  readonly _tag: "Layout";
  readonly segment: string;
  readonly path: Path;
  readonly render: (args: {
    readonly path: FieldsType<Path>;
    readonly outlet: Node<any, any>;
  }) => Node<any, any>;
  readonly children: readonly TreeNode[];
  /** Phantom marker for this layout subtree's aggregate error channel (see {@link TreeE}). */
  readonly _E?: (e: E) => void;
  /** Phantom marker for this layout subtree's aggregate requirement channel (see {@link TreeR}). */
  readonly _R?: (r: R) => void;
}

/** Any node in the route tree. */
export type TreeNode = RouteNode<any, any, any, any> | LayoutNode<any, any, any>;

/** Extracts the error channel from a single {@link TreeNode}. */
export type TreeE<T> =
  T extends RouteNode<any, any, infer E, any>
    ? E
    : T extends LayoutNode<any, infer E, any>
      ? E
      : never;

/** Extracts the requirement channel from a single {@link TreeNode}. */
export type TreeR<T> =
  T extends RouteNode<any, any, any, infer R>
    ? R
    : T extends LayoutNode<any, any, infer R>
      ? R
      : never;

/** Aggregate error channel over a children tuple (distributes over `C[number]`). */
export type SubtreeE<C extends readonly TreeNode[]> = TreeE<C[number]>;

/** Aggregate requirement channel over a children tuple (distributes over `C[number]`). */
export type SubtreeR<C extends readonly TreeNode[]> = TreeR<C[number]>;

/** Config object accepted by {@link route}. The `component` *is* the route handler. */
export interface RouteConfig<
  Path extends Fields = {},
  Query extends Fields = {},
  N extends Node<any, any> = Node,
> {
  /** Path-param field schemas for `:name` placeholders on this branch (leaf-owned). */
  readonly path?: Path;
  /** Query field schemas; query keys are typically optional. */
  readonly query?: Query;
  /** The page component, receiving its typed `{ path, query }`. */
  readonly component: (args: RouteArgs<Path, Query>) => N;
}

/** Config object accepted by {@link layout}. */
export interface LayoutConfig<
  Path extends Fields = {},
  C extends readonly TreeNode[] = readonly TreeNode[],
  N extends Node<any, any> = Node,
> {
  /** Path-param field schemas introduced by this layout's segment. */
  readonly path?: Path;
  /** Renders the layout around the typed `outlet`, receiving its typed `{ path }`. */
  readonly render: (args: LayoutRenderArgs<Path, C>) => N;
}

/**
 * Declares a leaf page. The `component` *is* the route handler and receives its
 * typed `{ path, query }`; its error / requirement channels propagate up the tree.
 *
 * @example
 * ```ts
 * Router.route("about", { component: () => h.h1({}, "About") });
 * Router.route("users/:id", {
 *   path: { id: Schema.NumberFromString },
 *   component: ({ path }) => h.div({}, `User ${path.id}`),
 * });
 * ```
 */
export function makeRoute<
  Path extends Fields = {},
  Query extends Fields = {},
  N extends Node<any, any> = Node,
>(
  segment: string,
  config: {
    readonly path?: Path;
    readonly query?: Query;
    readonly component: (args: RouteArgs<Path, Query>) => N;
  },
): RouteNode<Path, Query, Node.Error<N>, Node.Context<N>> {
  return {
    _tag: "Route",
    segment,
    path: (config.path ?? {}) as Path,
    query: (config.query ?? {}) as Query,
    component: config.component as RouteNode<
      Path,
      Query,
      Node.Error<N>,
      Node.Context<N>
    >["component"],
  };
}

/**
 * Declares a layout. `render` receives the next level down as a typed `outlet`
 * (place it in the returned tree) plus the layout's typed `{ path }`. The layout's
 * aggregate channels are its `render`'s channels unioned with its whole subtree's.
 *
 * @example
 * ```ts
 * Router.layout(
 *   "",
 *   { render: ({ outlet }) => h.div({ class: "shell" }, [Header(), outlet]) },
 *   [Router.route("", { component: () => Home() })],
 * );
 * ```
 */
export function makeLayout<
  Path extends Fields = {},
  C extends readonly TreeNode[] = readonly TreeNode[],
  N extends Node<any, any> = Node,
>(
  segment: string,
  config: {
    readonly path?: Path;
    readonly render: (args: {
      readonly path: FieldsType<Path>;
      readonly outlet: Node<SubtreeE<C> | RouterNotFound, SubtreeR<C> | Router>;
    }) => N;
  },
  children: C,
): LayoutNode<Path, Node.Error<N> | SubtreeE<C>, Node.Context<N> | SubtreeR<C>> {
  return {
    _tag: "Layout",
    segment,
    path: (config.path ?? {}) as Path,
    render: config.render as LayoutNode<Path>["render"],
    children,
  };
}
