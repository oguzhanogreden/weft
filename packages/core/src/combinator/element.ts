import { Effect } from "effect";
import { FRAGMENT } from "./fragment";
import type { HTMLElements, SVGElements } from "~/types";
import type { Child, ChildrenE, ChildrenR, CombinatorialProps, ElementFn, Node } from "./types";
import type { Source } from "~/source";

/** Augmentable interface for user-defined custom element tags and props. */
export interface CustomElements {}

type DataAttributes = {
  [attr: `data-${string}`]: Source.Source<string | number | undefined>;
};

type H = {
  [K in keyof HTMLElements]: ElementFn<CombinatorialProps<HTMLElements[K] & DataAttributes>>;
} & {
  [K in keyof SVGElements]: ElementFn<CombinatorialProps<SVGElements[K] & DataAttributes>>;
} & {
  [K in keyof CustomElements]: ElementFn<CustomElements[K] & DataAttributes>;
};

function createElementFn(tag: string): ElementFn<any> {
  return (propsOrChildren?: unknown, children?: unknown): Node<any, any> => {
    let props: Record<string, unknown> = {};
    let kids: unknown = undefined;

    if (Array.isArray(propsOrChildren)) {
      kids = propsOrChildren;
    } else if (propsOrChildren !== undefined) {
      props = propsOrChildren as Record<string, unknown>;
      if (children !== undefined) kids = children;
    }

    const finalProps = kids !== undefined ? { ...props, children: kids } : props;
    return Effect.succeed({ type: tag, props: finalProps }) as Node<any, any>;
  };
}

const cache = new Map<string, ElementFn<any>>();

/** Proxy-based element namespace. Access any HTML, SVG, or custom element as `h.tagName(props, children)`. */
export const h = new Proxy({} as H, {
  get(_, tag: string) {
    let fn = cache.get(tag);
    if (!fn) {
      fn = createElementFn(tag);
      cache.set(tag, fn);
    }
    return fn;
  },
});

/**
 * Creates a fragment node containing the given children.
 * Equivalent to `<>...</>` in JSX.
 */
export function hFragment<C extends readonly Child[]>(
  children: C,
): Node<ChildrenE<C>, ChildrenR<C>> {
  return Effect.sync(() => ({ type: FRAGMENT, props: { children } })) as Node<any, any>;
}
