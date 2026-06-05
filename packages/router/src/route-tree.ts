import type { Node } from "@effect-ui/core";
import type { Schema } from "effect";

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

/** Arguments handed to a layout `render`: the decoded path params for the level. */
export interface LayoutArgs<Path extends Fields> {
  readonly path: FieldsType<Path>;
}

/** A leaf page in the route tree. Its `component` is its handler. */
export interface RouteNode<Path extends Fields = {}, Query extends Fields = {}> {
  readonly _tag: "Route";
  readonly segment: string;
  readonly path: Path;
  readonly query: Query;
  readonly component: (args: RouteArgs<Path, Query>) => Node<any, any>;
}

/** A layout wrapping an outlet (the next level down) in the route tree. */
export interface LayoutNode<Path extends Fields = {}> {
  readonly _tag: "Layout";
  readonly segment: string;
  readonly path: Path;
  readonly render: (outlet: Node<any, any>, args: LayoutArgs<Path>) => Node<any, any>;
  readonly children: readonly TreeNode[];
}

/** Any node in the route tree. */
export type TreeNode = RouteNode<any, any> | LayoutNode<any>;

/** Optional config object accepted by {@link route}. */
export interface RouteConfig<Path extends Fields, Query extends Fields> {
  /** Path-param field schemas for `:name` placeholders on this branch (leaf-owned). */
  readonly path?: Path;
  /** Query field schemas; query keys are typically optional. */
  readonly query?: Query;
}

/** Optional config object accepted by {@link layout}. */
export interface LayoutConfig<Path extends Fields> {
  /** Path-param field schemas introduced by this layout's segment. */
  readonly path?: Path;
}

/**
 * Declares a leaf page. The `component` *is* the route handler and receives its
 * typed `{ path, query }`.
 *
 * @example
 * ```ts
 * route("about", () => h.h1({}, "About"));
 * route("users/:id", { path: { id: Schema.NumberFromString } }, ({ path }) =>
 *   h.div({}, `User ${path.id}`),
 * );
 * ```
 */
export function route<Query extends Fields = {}>(
  segment: string,
  component: (args: RouteArgs<{}, Query>) => Node<any, any>,
): RouteNode<{}, Query>;
export function route<Path extends Fields = {}, Query extends Fields = {}>(
  segment: string,
  config: RouteConfig<Path, Query>,
  component: (args: RouteArgs<Path, Query>) => Node<any, any>,
): RouteNode<Path, Query>;
export function route(
  segment: string,
  configOrComponent:
    | RouteConfig<Fields, Fields>
    | ((args: RouteArgs<Fields, Fields>) => Node<any, any>),
  maybeComponent?: (args: RouteArgs<Fields, Fields>) => Node<any, any>,
): RouteNode<any, any> {
  const hasConfig = typeof configOrComponent !== "function";
  const config = (hasConfig ? configOrComponent : {}) as RouteConfig<Fields, Fields>;
  const component = (hasConfig ? maybeComponent : configOrComponent) as (
    args: RouteArgs<Fields, Fields>,
  ) => Node<any, any>;
  return {
    _tag: "Route",
    segment,
    path: config.path ?? {},
    query: config.query ?? {},
    component,
  };
}

/**
 * Declares a layout. `render` receives the next level down as `outlet` (place it
 * in the returned tree) plus the layout's typed `{ path }`.
 *
 * @example
 * ```ts
 * layout("", (outlet) => h.div({ class: "shell" }, [Header(), outlet]), [
 *   route("", () => Home()),
 *   route("about", () => About()),
 * ]);
 * ```
 */
export function layout<Path extends Fields = {}>(
  segment: string,
  render: (outlet: Node<any, any>, args: LayoutArgs<Path>) => Node<any, any>,
  children: readonly TreeNode[],
): LayoutNode<Path>;
export function layout<Path extends Fields = {}>(
  segment: string,
  config: LayoutConfig<Path>,
  render: (outlet: Node<any, any>, args: LayoutArgs<Path>) => Node<any, any>,
  children: readonly TreeNode[],
): LayoutNode<Path>;
export function layout(
  segment: string,
  configOrRender:
    | LayoutConfig<Fields>
    | ((outlet: Node<any, any>, args: LayoutArgs<Fields>) => Node<any, any>),
  renderOrChildren:
    | ((outlet: Node<any, any>, args: LayoutArgs<Fields>) => Node<any, any>)
    | readonly TreeNode[],
  maybeChildren?: readonly TreeNode[],
): LayoutNode<any> {
  const hasConfig = typeof configOrRender !== "function";
  const config = (hasConfig ? configOrRender : {}) as LayoutConfig<Fields>;
  const render = (hasConfig ? renderOrChildren : configOrRender) as (
    outlet: Node<any, any>,
    args: LayoutArgs<Fields>,
  ) => Node<any, any>;
  const children = (hasConfig ? maybeChildren : renderOrChildren) as readonly TreeNode[];
  return {
    _tag: "Layout",
    segment,
    path: config.path ?? {},
    render,
    children: children ?? [],
  };
}
