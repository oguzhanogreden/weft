/**
 * Documentation routes.
 *
 * - `/docs` aliases to the first doc (getting-started) by rendering its content.
 * - `/docs/:category/:slug` looks up the doc model and renders it via `DocPage`;
 *   an unknown `(category, slug)`, or a doc whose section is `api` (served by the
 *   api routes), short-circuits to the router's not-found (404).
 *
 * Mounted under the `DocsShell` layout by `app.ts`.
 */

import { Component } from "@weftui/core";
import { Router, notFound } from "@weftui/router";
import { Schema } from "effect";
import { liveDocs } from "./../lib/docs-live";
import { DocPage } from "./doc-page";

/** `/docs` → render the first doc in nav order (alias to getting-started). */
export const docsIndexRoute = Router.route("docs", {
  component: Component.gen(function* () {
    const parts = liveDocs.nav.firstDocPath.split("/").filter((p) => p.length > 0);
    const doc =
      parts[1] !== undefined && parts[2] !== undefined
        ? liveDocs.get(parts[1], parts[2])
        : undefined;
    if (doc === undefined) return yield* notFound();
    return yield* DocPage(doc);
  }),
});

/** `/docs/:category/:slug` → the matching DocPage, or 404. */
export const docsRoute = Router.route("docs/:category/:slug", {
  component: Component.gen(function* () {
    const { category, slug } = yield* Router.params({
      category: Schema.String,
      slug: Schema.String,
    });
    const doc = liveDocs.get(category, slug);
    if (doc === undefined || doc.category === "api") return yield* notFound();
    return yield* DocPage(doc);
  }),
});
