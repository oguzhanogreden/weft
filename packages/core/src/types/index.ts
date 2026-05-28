import { Effect, Stream } from "effect";
import type { FRAGMENT } from "~/jsx-runtime";

export type JSXNode =
  | void
  | null
  | undefined
  | string
  | number
  | bigint
  | boolean
  | Iterable<JSXNode>
  | Stream.Stream<JSXNode, any, any>
  | Effect.Effect<JSXNode, any, any>
  | { type: JSXType; props: Record<string, unknown> };

export type JSXType = typeof FRAGMENT | string | ((props: Record<string, unknown>) => JSXNode);

export * from "./html/aria";
export * from "./html/attributes";
export * from "./html/dom";
export * from "./html/html";
export * from "./html/svg";
