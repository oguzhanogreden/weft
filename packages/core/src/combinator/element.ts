import { Effect } from "effect";
import { FRAGMENT } from "./fragment";
import type { HTMLElements, SVGElements } from "~/types";
import type {
  Child,
  ChildrenE,
  ChildrenR,
  CombinatorialProps,
  Node,
  PropsE,
  PropsR,
} from "./types";
import type { Source } from "~/source/source";

/** Augmentable interface for user-defined custom element tags and props. */
export interface CustomElements {}

export interface ElementFn<Props> {
  <P extends Props, C extends readonly Child[]>(
    props: P,
    children: C,
  ): Node<PropsE<P> | ChildrenE<C>, PropsR<P> | ChildrenR<C>>;
  <P extends Props>(props: P, child: string | number): Node<PropsE<P>, PropsR<P>>;
  <P extends Props>(props: P): Node<PropsE<P>, PropsR<P>>;
  <C extends readonly Child[]>(children: C): Node<ChildrenE<C>, ChildrenR<C>>;
  (): Node<never, never>;
}

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
  return ((propsOrChildren?: unknown, children?: unknown): Node<any, any> => {
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
  }) as ElementFn<any>;
}

/**
 * Builds an `h` proxy backed by the given cache. Each tag access lazily creates
 * an `ElementFn` and memoizes it in the cache, so repeat accesses return the
 * same function reference. Exposed primarily to allow tests to observe an
 * isolated cache; production code should use the module-level `h`.
 */
export function makeH(cache: Map<string, ElementFn<any>> = new Map()): H {
  return new Proxy<H>({} as H, {
    get(_, tag: string) {
      return cache.get(tag) ?? cache.set(tag, createElementFn(tag)).get(tag)!;
    },
  });
}

/** Proxy-based element namespace. Access any HTML, SVG, or custom element as `h.tagName(props, children)`. */
export const h: H = makeH();

/**
 * Creates a fragment node containing the given children.
 * Equivalent to `<>...</>` in JSX.
 */
export function hFragment<C extends readonly Child[]>(
  children: C,
): Node<ChildrenE<C>, ChildrenR<C>> {
  return Effect.sync(() => ({ type: FRAGMENT, props: { children } })) as Node<any, any>;
} /** Per-element call signatures and overloads. */
