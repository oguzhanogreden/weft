import type { Node } from "@effect-ui/core";
import { Schema } from "effect";
import type { LayoutNode, RouteNode, TreeE, TreeNode, TreeR } from "./route-tree";

/**
 * A compiled layout level: its render function plus the cumulative pattern prefix
 * (root → this layout) used by the client outlet to key the level for dedupe.
 */
export interface CompiledLayout {
  readonly segment: string;
  /** Cumulative pattern from the root through this layout, e.g. `/users/:id`. */
  readonly patternPrefix: string;
  /** Param names appearing in `patternPrefix`. */
  readonly paramNames: readonly string[];
  readonly render: (args: {
    path: Record<string, unknown>;
    outlet: Node<any, any>;
  }) => Node<any, any>;
}

/**
 * A compiled leaf route: the flattened routing contract for one page. `pathSchema`
 * merges every path field declared down the branch (leaf wins on collision) and
 * covers every `:name` placeholder (defaulting to `Schema.String`).
 */
export interface CompiledLeaf {
  /** Stable identifier derived from the full pattern; used as the HttpApi endpoint name. */
  readonly id: string;
  /** Full path pattern from the root, e.g. `/users/:id/settings` (root ⇒ `/`). */
  readonly fullPathPattern: string;
  /** Ordered param names in `fullPathPattern`. */
  readonly paramNames: readonly string[];
  readonly pathSchema: Schema.Schema<Record<string, unknown>, Record<string, unknown>>;
  readonly querySchema: Schema.Schema<Record<string, unknown>, Record<string, unknown>>;
  readonly component: (args: {
    path: Record<string, unknown>;
    query: Record<string, unknown>;
  }) => Node<any, any>;
  /** Ancestor layouts (root → parent) wrapping this leaf. */
  readonly layoutChain: readonly CompiledLayout[];
}

/** The result of compiling a route tree: a flat leaf list plus the not-found page. */
export interface Compiled {
  readonly leaves: readonly CompiledLeaf[];
  readonly notFound: () => Node<any, any>;
}

/**
 * A sealed, compiled router definition. The unit passed to the client and server.
 * `E`/`R` are phantom: they carry the aggregate error / requirement channels of
 * the whole tree (plus the not-found page) so {@link RouterApp} / {@link outletNode}
 * can surface a precise `Node` type instead of `Node<any, any>`.
 */
export interface RouterDef<E = any, R = any> {
  readonly root: TreeNode;
  readonly notFound: () => Node<any, any>;
  readonly compiled: Compiled;
  /** Phantom marker for the tree's aggregate error channel. */
  readonly _E?: (e: E) => void;
  /** Phantom marker for the tree's aggregate requirement channel. */
  readonly _R?: (r: R) => void;
}

/** Options for {@link router}. */
export interface RouterOptions<NF extends Node<any, any> = Node<any, any>> {
  /** App-level not-found page, rendered when no route matches or a page raises `RouterNotFound`. */
  readonly notFound: () => NF;
}

/**
 * Maps each authored {@link RouteNode} to its {@link CompiledLeaf}. Populated by
 * {@link compile} (via {@link router}) and read by `href` so a leaf reference can
 * resolve its full pattern and schemas.
 */
export const leafRegistry: WeakMap<RouteNode<any, any, any, any>, CompiledLeaf> = new WeakMap();

/** Splits a segment string into its non-empty path parts. */
function splitSegment(segment: string): readonly string[] {
  return segment.split("/").filter((s) => s.length > 0);
}

/** Joins cumulative path parts into a normalized pattern (`/`-prefixed, no trailing `/`). */
function toPattern(parts: readonly string[]): string {
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

/** Extracts `:name` placeholder names from cumulative path parts, in order. */
function extractParams(parts: readonly string[]): readonly string[] {
  return parts.filter((p) => p.startsWith(":")).map((p) => p.slice(1));
}

/** Derives a stable, identifier-safe id from a full path pattern. */
function patternToId(pattern: string, index: number): string {
  const base = pattern
    .replace(/:/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base.length === 0 ? `root_${index}` : `${base}_${index}`;
}

/**
 * Walks a route tree once into a flat list of {@link CompiledLeaf}s, assembling
 * full patterns and merging path-param schemas down each branch (C1–C6).
 */
export function compile(def: { root: TreeNode; notFound: () => Node<any, any> }): Compiled {
  const leaves: CompiledLeaf[] = [];

  const walk = (
    node: TreeNode,
    parentParts: readonly string[],
    parentPathFields: Record<string, Schema.Schema.Any>,
    chain: readonly CompiledLayout[],
  ): void => {
    const parts = [...parentParts, ...splitSegment(node.segment)];
    const mergedFields = {
      ...parentPathFields,
      ...(node.path as Record<string, Schema.Schema.Any>),
    };

    if (node._tag === "Layout") {
      const compiledLayout: CompiledLayout = {
        segment: node.segment,
        patternPrefix: toPattern(parts),
        paramNames: extractParams(parts),
        render: (node as LayoutNode<any, any, any>).render as unknown as CompiledLayout["render"],
      };
      for (const child of node.children) {
        walk(child, parts, mergedFields, [...chain, compiledLayout]);
      }
      return;
    }

    const fullPathPattern = toPattern(parts);
    const paramNames = extractParams(parts);
    const pathFields: Record<string, Schema.Schema.Any> = {};
    for (const name of paramNames) {
      pathFields[name] = mergedFields[name] ?? Schema.String;
    }
    const leaf: CompiledLeaf = {
      id: patternToId(fullPathPattern, leaves.length),
      fullPathPattern,
      paramNames,
      pathSchema: Schema.Struct(pathFields) as unknown as CompiledLeaf["pathSchema"],
      querySchema: Schema.Struct(
        (node as RouteNode<any, any, any, any>).query as Record<string, Schema.Schema.Any>,
      ) as unknown as CompiledLeaf["querySchema"],
      component: (node as RouteNode<any, any, any, any>).component as CompiledLeaf["component"],
      layoutChain: chain,
    };
    leaves.push(leaf);
    leafRegistry.set(node as RouteNode<any, any, any, any>, leaf);
  };

  walk(def.root, [], {}, []);
  return { leaves, notFound: def.notFound };
}

/**
 * Seals a route tree into a {@link RouterDef}, compiling it eagerly (so leaf
 * references are stamped for `href`) and capturing the app-level not-found page.
 * The tree's aggregate channels (plus the not-found page's) are carried on the
 * returned `RouterDef`'s phantom `E`/`R` params.
 */
export function makeRouter<T extends TreeNode, NF extends Node<any, any> = Node>(
  root: T,
  options: RouterOptions<NF>,
): RouterDef<TreeE<T> | Node.Error<NF>, TreeR<T> | Node.Context<NF>> {
  return {
    root,
    notFound: options.notFound,
    compiled: compile({ root, notFound: options.notFound }),
  };
}
