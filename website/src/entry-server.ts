/**
 * Server entry: renders the matched route to a hydratable HTML document.
 *
 * `makeHandler` returns a Web `fetch`-style streaming handler (`Request →
 * Response`) bound to a given client entry `src`. The dev server (`server.ts`)
 * passes `/src/entry-client.ts` and post-processes the HTML for Vite HMR; the prod
 * server passes the hashed artifact resolved from the Vite manifest and streams the
 * response untouched. `App` has no `Boundary.rpc`, so no `rpc` option is supplied.
 */

import { RouterServer } from "@weftui/router/server";
import { App } from "./app";
import { documentShell } from "./layouts/shell";

/** Builds the streaming web handler for a given client entry `src`. */
export const makeHandler = (clientEntry: string) =>
  RouterServer.toStreamingWebHandler(App, { document: documentShell(clientEntry) });
