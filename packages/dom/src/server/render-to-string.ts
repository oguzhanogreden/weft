import type { RenderNode } from "@effect-ui/core/types";
import { type Effect, Stream } from "effect";
import { renderToStreamFallbackOnly, renderToStreamHydratable } from "./render-to-stream";

/**
 * Serializes an Effect-infused JSX tree (`RenderNode`) into a single HTML string.
 * The server-side counterpart to the client DOM renderer, intended to produce
 * output isomorphic with what the client renderer creates in the browser.
 *
 * Suspense boundaries render their fallback directly — no comment markers
 * and no `<template>`/`<script>` patches. For streaming Suspense support use
 * {@link renderToStreamHydratable} / {@link renderToStream} instead.
 */
export const renderToString = (node: RenderNode): Effect.Effect<string, Error> =>
  renderToStreamFallbackOnly(node).pipe(Stream.mkString);

/**
 * Like {@link renderToString}, but emits the reactive-region comment markers
 * (`<!-- stream-start-N -->` … `<!-- stream-end-N -->`) that the client
 * `hydrate` needs to locate reactive regions. Use this when the page will be
 * hydrated on the client; use {@link renderToString} for static, non-hydrated
 * output.
 *
 * Re-derived from {@link renderToStreamHydratable} via `Stream.mkString`.
 */
export const renderToStringHydratable = (node: RenderNode): Effect.Effect<string, Error> =>
  renderToStreamHydratable(node).pipe(Stream.mkString);
