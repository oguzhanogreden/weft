/**
 * API reference routes.
 *
 * - `/api` aliases to the first API doc by rendering its content.
 * - `/api/:pkg` looks up `docs/api/<pkg>.md`'s model and renders it via `DocPage`;
 *   an unknown `:pkg` short-circuits to the router's not-found (404).
 *
 * Same rendering path as the doc routes (API reference is documentation with its own
 * nav group); separated only by route prefix and nav grouping. `:pkg` is validated
 * against the doc model rather than a hardcoded list, so adding `docs/api/<new>.md`
 * works with no code change. Mounted under the `DocsShell` layout by `app.ts`.
 */

import { Component } from "@weftui/core";
import { Router, notFound } from "@weftui/router";
import { Schema } from "effect";
import { Docs, type DocsService } from "./../lib/docs-service";
import { DocPage } from "./doc-page";

/** The slug of the first API doc in nav order (e.g. `"core"`), if any. */
function firstApiSlug(nav: DocsService["nav"]): string | undefined {
  const group = nav.groups.find((g) => g.section === "api");
  const path = group?.links[0]?.path;
  return path?.split("/").filter((p) => p.length > 0)[1];
}

/** `/api` → render the first API doc (alias to /api/core). */
export const apiIndexRoute = Router.route("api", {
  component: Component.gen(function* () {
    const docs = yield* Docs;
    const slug = firstApiSlug(docs.nav);
    const doc = slug === undefined ? undefined : docs.get("api", slug);
    if (doc === undefined) return yield* notFound();
    return yield* DocPage(doc);
  }),
});

/** `/api/:pkg` → the matching API reference page, or 404. */
export const apiRoute = Router.route("api/:pkg", {
  component: Component.gen(function* () {
    const docs = yield* Docs;
    const { pkg } = yield* Router.params({ pkg: Schema.String });
    const doc = docs.get("api", pkg);
    if (doc === undefined) return yield* notFound();
    return yield* DocPage(doc);
  }),
});
