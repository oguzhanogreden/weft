import type { HTMLElements, JSXChild, JSXType, SVGElements } from "@effect-ui/html-types";

export { FRAGMENT, Fragment } from "@effect-ui/html-types";

export function jsx(
  type: JSXType,
  props: { [key: string]: unknown; children?: JSXChild | JSXChild[] } | null,
  ...children: JSXChild[]
): JSXChild {
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

/**
 * Development variant of the automatic JSX runtime entry point.
 *
 * Vite/esbuild emit calls to this function (imported from
 * `@effect-ui/jsx-runtime/jsx-dev-runtime`) when transforming JSX with the
 * automatic runtime in development mode. Children are passed inside `props`,
 * so we delegate to {@link jsx}; the dev-only metadata arguments (`key`,
 * `isStaticChildren`, `source`, `self`) are currently ignored.
 */
export function jsxDEV(
  type: JSXType,
  props: { [key: string]: unknown; children?: JSXChild | JSXChild[] } | null,
): JSXChild {
  return jsx(type, props);
}

declare global {
  namespace JSX {
    type Element = JSXChild;

    interface IntrinsicElements extends HTMLElements, SVGElements {}

    // interface IntrinsicAttributes {}
    // interface ElementChildrenAttribute {}
  }
}
