/**
 * Server entry: renders `<App/>` to hydratable HTML.
 *
 * `renderToStringHydratable` emits the `<!-- stream-start-N -->` /
 * `<!-- stream-end-N -->` markers around the reactive counter region that the
 * client `hydrate` needs to resume it flash-free.
 */

import { renderToStringHydratable } from "@effect-ui/dom/server";
import { Effect } from "effect";
import { App } from "./app";

/** Renders the app to a hydratable HTML string. */
export const render = (): Promise<string> => Effect.runPromise(renderToStringHydratable(<App />));
