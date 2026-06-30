# API reference routes — spec

## Overview & purpose

Routes and `ApiPage` for per-package API reference, sourced from `docs/api/*.md`.
Same rendering path as DocPage (API reference is documentation with its own nav
group); separated only by route prefix and nav grouping.

## Routes

- `/api` → alias to the first API doc (e.g. `/api/core`).
- `/api/:pkg` → `ApiPage` where `:pkg` ∈ {`core`, `dom`, `router`}: look up the
  matching `docs/api/<pkg>.md` doc model; render via `renderHast`. Unknown `:pkg`
  → `notFound` (404).

Mounted under the same `DocsShell` layout so chrome/sidebar/TOC are shared. The
sidebar's "API Reference" group (from the `api` section) links here.

## Acceptance criteria

- AC1: `/api/core`, `/api/dom`, `/api/router` each render the corresponding API doc.
- AC2: `/api` aliases to the first API doc.
- AC3: Unknown `:pkg` → 404.
- AC4: API pages appear under the "API Reference" sidebar group, ordered by
  frontmatter `order`.
- AC5: `<title>`/meta reflect the API doc frontmatter.
- AC6: SSR + hydrate identical (no mismatch).

## Notes

- If only `docs/api/core.md`, `dom.md`, `router.md` exist, `:pkg` is effectively a
  fixed set; still validate against the doc model rather than a hardcoded list so
  adding `docs/api/<new>.md` works with no code change.
