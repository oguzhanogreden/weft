import type { Properties as CSSProperties } from "csstype";
import type { Source } from "~/source";

export type HTMLAttributeSource<T> = Source.Source<T | undefined>;

export type StyleProperties = {
  [K in keyof CSSProperties]?: HTMLAttributeSource<CSSProperties[K]>;
};

export type StyleAttributeValue =
  | string // Style string: "color: red; font-size: 16px"
  | StyleProperties // Object with potentially stream properties
  | Source.Source<string>
  | Source.Source<StyleProperties>;
