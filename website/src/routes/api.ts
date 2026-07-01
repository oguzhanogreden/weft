/**
 * API reference route descriptors.
 *
 * - `/api` aliases to the first API doc by rendering its content.
 * - `/api/:pkg` looks up `docs/api/<pkg>.md`'s model and renders it via `DocPage`;
 *   an unknown `:pkg` short-circuits to the router's not-found (404).
 *
 * Same rendering path as the doc routes (API reference is documentation with its own
 * nav group); separated only by route prefix and nav grouping. Like the doc routes,
 * only the eager **descriptors** live here — each component body is
 * `Router.lazy(() => import("./doc-page-impl"))`, sharing the doc render chunk.
 * `:pkg` is validated against the doc model rather than a hardcoded list, so adding
 * `docs/api/<new>.md` works with no code change. Mounted under the `DocsShell`
 * layout by `app.ts`.
 */

import { Router } from "@weftui/router";

/** `/api` → render the first API doc (alias to /api/core). */
export const apiIndexRoute = Router.route("api", {
  component: Router.lazy(() => import("./doc-page-impl").then((m) => m.ApiIndexPage)),
});

/** `/api/:pkg` → the matching API reference page, or 404. */
export const apiRoute = Router.route("api/:pkg", {
  component: Router.lazy(() => import("./doc-page-impl").then((m) => m.ApiPage)),
});
