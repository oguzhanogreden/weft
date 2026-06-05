/**
 * Server entry: renders the matched route to a hydratable HTML document.
 *
 * `documentShell` is the typed document shell — it builds `<html>/<head>/<body>`
 * with the `#root` mount point and the client entry `<script>`. `RouterServer`
 * matches the request URL, renders `RouterApp(App)` inside the shell to hydratable
 * HTML, and reports the status (404 for not-found). `<!DOCTYPE html>` is prepended
 * by `RouterServer`.
 *
 * Both `render` (returning `{ html, status }`) and the `@effect/platform`-style
 * `handler` (`Request → Response`, via `RouterServer.toWebHandler`) are exported;
 * the dev server uses `handler` and post-processes the HTML for Vite HMR.
 */

import { h } from "@effect-ui/core";
import type { Node } from "@effect-ui/core";
import { RouterServer } from "@effect-ui/router/server";
import { Effect } from "effect";
import { App } from "./app";

/** The document shell wrapping the app node. */
export const documentShell = (app: Node<any, any>): Node<any, any> =>
  h.html({ lang: "en" }, [
    h.head({}, [
      h.meta({ charset: "utf-8" }),
      h.meta({ name: "viewport", content: "width=device-width, initial-scale=1" }),
      h.title({}, "effect-ui — router SSR"),
    ]),
    h.body({}, [
      h.div({ id: "root" }, [app]),
      h.script({ type: "module", src: "/src/entry-client.ts" }),
    ]),
  ]);

/** Renders `url` to `{ html, status }`. */
export const render = (url: string): Promise<{ html: string; status: number }> =>
  Effect.runPromise(RouterServer.render(App, { document: documentShell, url }));

/** A Web `fetch`-style handler rendering the matched route to `text/html`. */
export const handler = RouterServer.toWebHandler(App, { document: documentShell });
