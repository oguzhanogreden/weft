import type { Effect, Stream, Subscribable } from "effect";

/**
 * Widens a single prop value type so that Stream/Effect/Subscribable variants
 * accept any E and R — not just `never`. Static values (string, number, etc.)
 * are left unchanged. TypeScript distributes this over union types.
 */
export type OpenPropSource<T> =
  T extends Stream.Stream<infer A, any, any>
    ? Stream.Stream<A, any, any>
    : T extends Effect.Effect<infer A, any, any>
      ? Effect.Effect<A, any, any>
      : T extends Subscribable.Subscribable<infer A, any, any>
        ? Subscribable.Subscribable<A, any, any>
        : T;

/** Rendered element descriptor — shape matches JSX element so it's assignable to JSXNode. */
export interface DOMNode {
  readonly type: string | symbol | ((props: Record<string, unknown>) => unknown);
  readonly props: Record<string, unknown>;
}

/**
 * A node in the combinator tree.
 * IS an Effect — `yield*`, `Effect.gen`, and `pipe` all work natively.
 */
export type Node<E = never, R = never> = Effect.Effect<DOMNode, E, R>;

/** Valid child types — mirrors JSXNode: Node, Stream, Effect, primitives, null/undefined. */
export type Child =
  | Node<any, any>
  | Stream.Stream<unknown, any, any>
  | Effect.Effect<unknown, any, any>
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Iterable<Child>;

/** Extract E from a props object — Stream/Effect/Subscribable prop values contribute their E channel. */
export type PropsE<P> = {
  [K in keyof P]: P[K] extends Stream.Stream<any, infer E, any>
    ? E
    : P[K] extends Effect.Effect<any, infer E, any>
      ? E
      : P[K] extends Subscribable.Subscribable<any, infer E, any>
        ? E
        : never;
}[keyof P];

/** Extract R from a props object — Stream/Effect/Subscribable prop values contribute their R channel. */
export type PropsR<P> = {
  [K in keyof P]: P[K] extends Stream.Stream<any, any, infer R>
    ? R
    : P[K] extends Effect.Effect<any, any, infer R>
      ? R
      : P[K] extends Subscribable.Subscribable<any, any, infer R>
        ? R
        : never;
}[keyof P];

/** Extract E from a children array — Node (Effect) and Stream children contribute their E. */
export type ChildrenE<T extends readonly Child[]> = [T[number]] extends [never]
  ? never
  : {
      [K in keyof T]: T[K] extends Effect.Effect<any, infer E, any>
        ? E
        : T[K] extends Stream.Stream<any, infer E, any>
          ? E
          : never;
    }[number];

/** Extract R from a children array — Node (Effect) and Stream children contribute their R. */
export type ChildrenR<T extends readonly Child[]> = [T[number]] extends [never]
  ? never
  : {
      [K in keyof T]: T[K] extends Effect.Effect<any, any, infer R>
        ? R
        : T[K] extends Stream.Stream<any, any, infer R>
          ? R
          : never;
    }[number];

/**
 * Strip `children` from HTML prop types and widen all Source prop types to
 * allow any E/R — so callers can pass `Stream<T, E, R>` with real requirements.
 */
export type CombinatorialProps<P> = {
  [K in keyof Omit<P, "children">]: OpenPropSource<Omit<P, "children">[K]>;
};
