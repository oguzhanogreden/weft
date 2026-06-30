/**
 * Navigation manifest, derived from doc frontmatter.
 *
 * The sidebar is **data, not a hand-maintained list**: `buildNav` aggregates every
 * `DocModel` (from the baked `virtual:weft-docs` model) into grouped, ordered nav
 * data, and the module-level consts apply it to the real doc set. Adding a
 * `docs/**\/*.md` with frontmatter makes it appear in the sidebar with no other code
 * change. `buildNav` is the pure unit (unit-tested against fixtures); the consts are
 * the wired-up surface consumed by the docs shell and routing.
 */

import { getAllDocs } from "virtual:weft-docs";
import type { DocModel } from "./markdown-loader";

/** A single sidebar / prev-next link. */
export type NavLink = {
  readonly title: string;
  readonly path: string;
  readonly section: string;
};

/** A labelled group of nav links (one per `section`). */
export type NavGroup = {
  readonly section: string;
  readonly label: string;
  readonly links: readonly NavLink[];
};

/** The current link and its doc-order neighbours. */
export type NavNeighbours = {
  readonly current?: NavLink;
  readonly prev?: NavLink;
  readonly next?: NavLink;
};

/** Everything `buildNav` derives from a doc set. */
export type NavData = {
  readonly groups: readonly NavGroup[];
  readonly flat: readonly NavLink[];
  readonly firstDocPath: string;
  readonly findNav: (path: string) => NavNeighbours;
};

/** Fixed display order for the known sections; others are appended alphabetically. */
const SECTION_ORDER = ["guides", "concepts", "api"];

/** Human labels for the known sections. */
const SECTION_LABELS: Record<string, string> = {
  guides: "Guides",
  concepts: "Concepts",
  api: "API Reference",
};

/** Human label for a section, falling back to a capitalized section name. */
function labelFor(section: string): string {
  return SECTION_LABELS[section] ?? section.charAt(0).toUpperCase() + section.slice(1);
}

/** Route path for a doc: `api` docs map to `/api/:pkg`, everything else to `/docs/:section/:slug`. */
function linkPath(doc: DocModel): string {
  return doc.category === "api" ? `/api/${doc.slug}` : `/docs/${doc.category}/${doc.slug}`;
}

/** Orders two sections: fixed order first, then any extras alphabetically. */
function compareSections(a: string, b: string): number {
  const ia = SECTION_ORDER.indexOf(a);
  const ib = SECTION_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

/** Orders two docs within a group by `order`, tie-broken deterministically by `title`. */
function compareDocs(a: DocModel, b: DocModel): number {
  // Infinity - Infinity is NaN (falsy) → falls through to the title tie-break.
  return (
    a.frontmatter.order - b.frontmatter.order ||
    a.frontmatter.title.localeCompare(b.frontmatter.title)
  );
}

/** Builds grouped/ordered nav data from a doc set. Pure — same input yields the same nav. */
export function buildNav(docs: readonly DocModel[]): NavData {
  const bySection = new Map<string, DocModel[]>();
  for (const doc of docs) {
    const bucket = bySection.get(doc.category);
    if (bucket) bucket.push(doc);
    else bySection.set(doc.category, [doc]);
  }

  const groups: NavGroup[] = [...bySection.keys()].sort(compareSections).map((section) => ({
    section,
    label: labelFor(section),
    links: (bySection.get(section) ?? [])
      .slice()
      .sort(compareDocs)
      .map((doc) => ({ title: doc.frontmatter.title, path: linkPath(doc), section })),
  }));

  const flat = groups.flatMap((group) => group.links);
  const firstDocPath = flat[0]?.path ?? "/docs";

  const findNav = (path: string): NavNeighbours => {
    const index = flat.findIndex((link) => link.path === path);
    if (index === -1) return {};
    return {
      current: flat[index],
      prev: index > 0 ? flat[index - 1] : undefined,
      next: index < flat.length - 1 ? flat[index + 1] : undefined,
    };
  };

  return { groups, flat, firstDocPath, findNav };
}

const data = buildNav(getAllDocs());

/** Ordered nav groups, ready for the sidebar. */
export const navGroups = data.groups;
/** Flat doc-order link list, for prev/next. */
export const flatNav = data.flat;
/** Path of the first doc — the `/docs` alias target. */
export const firstDocPath = data.firstDocPath;
/** Resolves the current link and its neighbours for a route path. */
export const findNav = data.findNav;
