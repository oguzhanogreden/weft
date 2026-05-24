/**
 * Server entry: renders `<App/>` to streaming hydratable HTML.
 *
 * `renderToStreamHydratable` emits each `<Suspense>` boundary's fallback
 * inline (between `<!-- suspense-start-N -->` / `<!-- suspense-end-N -->`
 * markers), then appends a `<template>` + self-removing `<script>` patch as
 * each boundary's children resolve. The browser executes those scripts before
 * `hydrate()` runs, so the page is already in its resolved state by the time
 * the client JS loads.
 */

import { renderToStreamHydratable } from "@effect-ui/dom/server";
import { Effect, Stream } from "effect";
import { App } from "./app";

/** Renders the app to a hydratable HTML string including Suspense patches. */
export const render = (): Promise<string> =>
  Effect.runPromise(renderToStreamHydratable(<App />).pipe(Stream.mkString));
