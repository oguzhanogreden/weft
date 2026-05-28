import { Effect, Stream } from "effect";

/** The tag type for renderable element descriptors. */
export type ElementType = symbol | string | ((props: Record<string, unknown>) => unknown);

/**
 * Every value the renderer can process: primitives, iterables, reactive
 * streams/effects, and element descriptors produced by `h`, `hFragment`, or
 * `Suspense`.
 */
export type RenderNode =
  | void
  | null
  | undefined
  | string
  | number
  | bigint
  | boolean
  | Iterable<RenderNode>
  | Stream.Stream<RenderNode, any, any>
  | Effect.Effect<RenderNode, any, any>
  | { type: ElementType; props: Record<string, unknown> };

export * from "./html/aria";
export * from "./html/attributes";
export * from "./html/dom";
export * from "./html/html";
export * from "./html/svg";
