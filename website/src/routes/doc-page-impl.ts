/**
 * Lazy route-component bodies for the doc + api routes.
 *
 * This module is the **heavy** half of the doc/api routes: it pulls in `DocPage`
 * (and thus `render-hast`, `CodeBlock`, `Demo`), the `Docs` service, and the
 * per-route render logic. It is imported **only** through `Router.lazy(() =>
 * import("./doc-page-impl"))` in the eager descriptor files (`routes/docs.ts`,
 * `routes/api.ts`), so this whole render body is emitted as its own chunk and never
 * enters the initial module graph — a request renders one leaf, so only that leaf's
 * lazy component chunk loads (server render + client nav; see
 * `packages/router/src/lazy-component.specs.md`).
 *
 * Each export is a `Component` whose `E`/`R` (`Docs`, `Router.params`) propagate
 * through `Router.lazy` unchanged, so the sealed router type is identical to
 * declaring these bodies eagerly.
 */

import { Component } from "@weftui/core";
import { Router, notFound } from "@weftui/router";
import { Schema } from "effect";
import { Docs, type DocsService } from "./../lib/docs-service";
import { DocPage } from "./doc-page";

/** `/docs` → render the first doc in nav order (alias to getting-started). */
export const DocsIndexPage = Component.gen(function* () {
  const docs = yield* Docs;
  const parts = docs.nav.firstDocPath.split("/").filter((p) => p.length > 0);
  const doc =
    parts[1] !== undefined && parts[2] !== undefined
      ? yield* docs.load(parts[1], parts[2])
      : undefined;
  if (doc === undefined) return yield* notFound();
  return yield* DocPage(doc);
});

/** `/docs/:category/:slug` → the matching DocPage, or 404. */
export const DocsPage = Component.gen(function* () {
  const docs = yield* Docs;
  const { category, slug } = yield* Router.params({
    category: Schema.String,
    slug: Schema.String,
  });
  const doc = yield* docs.load(category, slug);
  if (doc === undefined || doc.category === "api") return yield* notFound();
  return yield* DocPage(doc);
});

/** The slug of the first API doc in nav order (e.g. `"core"`), if any. */
function firstApiSlug(nav: DocsService["nav"]): string | undefined {
  const group = nav.groups.find((g) => g.section === "api");
  const path = group?.links[0]?.path;
  return path?.split("/").filter((p) => p.length > 0)[1];
}

/** `/api` → render the first API doc (alias to /api/core). */
export const ApiIndexPage = Component.gen(function* () {
  const docs = yield* Docs;
  const slug = firstApiSlug(docs.nav);
  const doc = slug === undefined ? undefined : yield* docs.load("api", slug);
  if (doc === undefined) return yield* notFound();
  return yield* DocPage(doc);
});

/** `/api/:pkg` → the matching API reference page, or 404. */
export const ApiPage = Component.gen(function* () {
  const docs = yield* Docs;
  const { pkg } = yield* Router.params({ pkg: Schema.String });
  const doc = yield* docs.load("api", pkg);
  if (doc === undefined) return yield* notFound();
  return yield* DocPage(doc);
});
