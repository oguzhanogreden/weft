import type { Effect, Stream } from "effect";
import type { Properties as CSSProperties } from "csstype";
import type { JSXRequirements } from "..";

export type AttributeValue<T> =
  | T
  | undefined
  | Stream.Stream<T | undefined, never, JSXRequirements>
  | Effect.Effect<T | undefined, never, JSXRequirements>;

export type StreamableStyleValue<T> =
  | T
  | Stream.Stream<string | number, never, JSXRequirements>
  | Effect.Effect<string | number, never, JSXRequirements>;

export type StreamableStyleObject = {
  [K in keyof CSSProperties]?: AttributeValue<CSSProperties[K]>;
};

export type StyleAttributeValue =
  | string // Style string: "color: red; font-size: 16px"
  | StreamableStyleObject // Object with potentially stream properties
  | Stream.Stream<string, never, JSXRequirements> // Stream of style strings
  | Stream.Stream<StreamableStyleObject, never, JSXRequirements> // Stream of style objects
  | Effect.Effect<string, never, JSXRequirements> // Effect of style string
  | Effect.Effect<StreamableStyleObject, never, JSXRequirements>; // Effect of style object
