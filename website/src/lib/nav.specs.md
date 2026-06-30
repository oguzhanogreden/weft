# Nav manifest — spec

## Overview & purpose

Derives the site navigation **from doc frontmatter**, so the sidebar is data, not
a hand-maintained list. Aggregates every `DocModel` (from the markdown loader)
into grouped, ordered nav data consumed by the docs shell and routing.

## Public surface

```ts
type NavLink = { title: string; path: string; section: string };
type NavGroup = { section: string; label: string; links: NavLink[] };

export const navGroups: NavGroup[]; // ordered, ready for sidebar
export const flatNav: NavLink[]; // doc order, for prev/next
export const firstDocPath: string; // /docs alias target
export const findNav: (path: string) => {
  // current + neighbours
  current?: NavLink;
  prev?: NavLink;
  next?: NavLink;
};
```

## Behaviour

- Group by `frontmatter.section`; sort links within a group by `frontmatter.order`
  then `title`. Group order is fixed: `guides`, `concepts`, `api` (others appended
  alphabetically).
- `label` is a human title per section (`guides` → "Guides", `concepts` →
  "Concepts", `api` → "API Reference").
- `path` is the route path: `/docs/:section/:slug`, or `/api/:pkg` for the `api`
  section.
- `flatNav` is the concatenation of groups in display order — drives prev/next.

## Acceptance criteria

- AC1: `navGroups` contains one group per distinct `section`, in the fixed order.
- AC2: Links within a group are ordered by `order` then `title`.
- AC3: `firstDocPath` equals the path of the first link in the first group
  (getting-started) — used as the `/docs` alias target.
- AC4: `findNav(path)` returns the matching `current` and correct `prev`/`next`
  per `flatNav`; ends of the list yield `undefined` neighbours.
- AC5: Manifest is pure data built from the doc model — adding a `docs/*.md` with
  frontmatter makes it appear in the sidebar with no other code change.

## Edge cases

- Two docs with the same `order` in a group → stable, deterministic tie-break by
  `title`.
- `api` section sourced from `docs/api/*` maps to `/api/:pkg`, not
  `/docs/api/:pkg`.
