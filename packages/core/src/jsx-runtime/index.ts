import type { HTMLElements, JSXNode, JSXType, SVGElements } from "~/types";

export * from "./fragment";

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
    // interface IntrinsicAttributes {}
    // interface ElementChildrenAttribute {}
  }
}
