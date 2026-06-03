/**
 * Server entry: renders `<App/>` to hydratable HTML.
 *
 * `renderToStringHydratable` runs the `Boundary.server` `load` (reading the
 * server-only `Database`), emits the inline `<script type="application/json">`
 * product payload at the region cursor, and renders `render(product)` HTML in
 * place — plus the `<!-- stream-start-N -->` / `<!-- stream-end-N -->` markers
 * around the reactive quantity region. The client `hydrate` replays the payload
 * and resumes that region flash-free.
 */

import { renderToStringHydratable } from "@effect-ui/dom/server";
import { Effect } from "effect";
import { App } from "./app";

/** Renders the app to a hydratable HTML string. */
export const render = (): Promise<string> => Effect.runPromise(renderToStringHydratable(App()));
