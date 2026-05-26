import type { Component } from "~/component/component";
import type { HTMLElements, JSXNode, JSXType, MaybeReactive, SVGElements } from "~/types";

export * from "./fragment";
type PropsIn<T> = { [K in keyof T]: MaybeReactive<T[K]> };

export function jsx(
  type: JSXType,
  props: { [key: string]: unknown; children?: JSXNode | JSXNode[] } | null,
  ...children: JSXNode[]
): JSXNode {
  // Handle the classic JSX transform where children are passed as additional arguments
  const normalizedProps = props ?? {};

  // If children are passed as arguments (classic transform), add them to props
  if (children.length > 0) {
    return {
      type,
      props: {
        ...normalizedProps,
        children: children.length === 1 ? children[0] : children,
      },
    };
  }

  // Otherwise use children from props (automatic transform)
  return { type, props: normalizedProps };
}

export const jsxs: typeof jsx = jsx;

export function jsxDEV(
  type: JSXType,
  props: { [key: string]: unknown; children?: JSXNode | JSXNode[] } | null,
): JSXNode {
  return jsx(type, props);
}

declare global {
  namespace JSX {
    type Element = JSXNode;

    interface IntrinsicElements extends HTMLElements, SVGElements {}
    // For components defined via `component()`, derive the caller view from the
    // branded raw prop shape; otherwise wrap the inferred props per-slot.
    type LibraryManagedAttributes<C, P> =
      C extends Component<infer Raw> ? PropsIn<Raw> : PropsIn<P>;
    // interface IntrinsicAttributes {}
    // interface ElementChildrenAttribute {}
  }
}
