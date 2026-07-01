/**
 * The documentation model surface.
 *
 * `makeDocs` builds an indexed, nav-derived view over a doc set, exposed to route
 * components / layouts / the document shell as the {@link Docs} Effect service. The
 * build-time-backed {@link DocsService} value and its `DocsLive` layer live in
 * `docs-live.ts`; the layer is provided through `RouterServer.render` /
 * `RouterLive`'s render-time `context` seam (see
 * `packages/router/ambient-context-propagation.specs.md`), so every route leaf can
 * `yield* Docs`. `makeDocs` stays pure and dependency-free so it is unit-testable
 * with fixtures (and tests provide a fixture `Docs` layer).
 */

import { Context } from "effect";
import type { DocModel } from "./markdown-loader";
import { type NavData, buildNav } from "./nav";

/** The documentation model surface shared across the site. */
export interface DocsService {
  /** Every doc, unordered. */
  readonly all: readonly DocModel[];
  /** Looks up a doc by `(category, slug)`, or `undefined`. */
  readonly get: (category: string, slug: string) => DocModel | undefined;
  /** The nav manifest derived from `all` (groups, flat order, first path, neighbours). */
  readonly nav: NavData;
}

/**
 * The `Docs` Effect service: the app-wide documentation model, injected through the
 * router's render-time `context` seam and read by any route/layout/shell via
 * `yield* Docs`. `DocsLive` (build-time model) and fixture layers live in `docs-live.ts`.
 */
export class Docs extends Context.Tag("website/Docs")<Docs, DocsService>() {}

/** Builds a `DocsService` from a doc set: an index map plus the derived nav. */
export function makeDocs(all: readonly DocModel[]): DocsService {
  const byKey = new Map(all.map((doc) => [`${doc.category}/${doc.slug}`, doc]));
  return {
    all,
    get: (category, slug) => byKey.get(`${category}/${slug}`),
    nav: buildNav(all),
  };
}
