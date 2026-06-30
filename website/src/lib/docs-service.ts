/**
 * The documentation model surface.
 *
 * `makeDocs` builds an indexed, nav-derived view over a doc set. The build-time-backed
 * singleton lives in `docs-live.ts` (`liveDocs`), which route components and the
 * document shell import directly — a plain module value rather than an Effect service,
 * because the router renders route leaves in a fixed context that an app-provided
 * service cannot reach (see `packages/router/ambient-context-propagation.specs.md`).
 * `makeDocs` stays pure and dependency-free so it is unit-testable with fixtures.
 */

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

/** Builds a `DocsService` from a doc set: an index map plus the derived nav. */
export function makeDocs(all: readonly DocModel[]): DocsService {
  const byKey = new Map(all.map((doc) => [`${doc.category}/${doc.slug}`, doc]));
  return {
    all,
    get: (category, slug) => byKey.get(`${category}/${slug}`),
    nav: buildNav(all),
  };
}
