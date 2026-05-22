import type { JSXNode } from "@effect-ui/core/types";
import { type Effect, Stream } from "effect";
import { renderToStream } from "./render-to-stream";

/**
 * Serializes an Effect-infused JSX tree (`JSXNode`) into a single HTML string.
 * The server-side counterpart to the client DOM renderer, intended to produce
 * output isomorphic with what the client renderer creates in the browser.
 *
 * Re-derived from {@link renderToStream} by concatenating its chunks — the
 * string-accumulating destination equivalent.
 */
export const renderToString = (node: JSXNode): Effect.Effect<string, Error> =>
  renderToStream(node).pipe(Stream.mkString);
