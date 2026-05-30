import type { RenderNode } from "~/types";
import type { Child, ChildrenE, ChildrenR, Node } from "~/combinator/types";
import { Effect } from "effect";

/**
 * Props for the {@link Suspense} boundary — used by renderers to access
 * `fallback` and `children` from the node descriptor.
 */
export interface SuspenseProps {
  /**
   * Shown in the DOM while async children are pending. Pass `null` or omit to
   * render nothing (only the comment markers) while pending.
   */
  readonly fallback?: RenderNode;
  /** The children to render inside the boundary. */
  readonly children?: RenderNode | readonly RenderNode[];
}

/**
 * Creates a Suspense boundary node.
 *
 * Shows `fallback` while async children are pending (have not yet emitted
 * their first value), then atomically swaps to the resolved children once
 * **all** pending children have settled.
 *
 * The renderer (`@effect-ui/dom`) identifies boundaries via `type === Suspense`
 * reference equality — the same function reference is embedded as `type`.
 *
 * @example
 * ```ts
 * import { Suspense } from "@effect-ui/core";
 *
 * Suspense({ fallback: h.div({}, "Loading…") }, [AsyncCard({}), AsyncSidebar({})])
 * ```
 */
export function Suspense<C extends readonly Child[]>(
  props: { readonly fallback?: Child },
  children: C,
): Node<ChildrenE<C>, ChildrenR<C>> {
  // Return a plain descriptor (not an Effect) so the renderer processes it
  // synchronously via the {type, props} branch — same path as JSX <Suspense>.
  // The `as unknown` cast is necessary because ElementType requires a
  // single-arg function, but Suspense takes two args.
  return Effect.succeed({
    type: Suspense,
    props: { ...props, children },
  }) as unknown as Node<ChildrenE<C>, ChildrenR<C>>;
}
