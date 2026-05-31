# Diffing Model — Checklist & Status

> Plan: [`diffing-model.plan.md`](./diffing-model.plan.md)
> Approved plan (archive): `~/.claude/plans/last-option-spec-discussion-to-abundant-wall.md`
> Branch: `perf/diffing-model` (currently even with `main`)

## Status summary

Design is locked via spec discussion. Mid **Part A**. Only change in the working tree
so far is the `dom.specs.md` AC20 amendment + these two doc files. No tests run yet.

Follow CLAUDE.md spec → mock → test → implement for each phase.

## Checklist

### Setup

- [x] Explore renderer, combinator API, node model, marker protocol, `Source` type
- [x] Spec discussion → final API (`List.each`, `of`, `by`, render-children shape)
- [x] Write plan (`diffing-model.plan.md`)

### Part A — scalar same-type patching (task #1, in_progress)

- [x] Amend `dom.specs.md` AC20 → SP1–SP4
- [ ] Add SP1/SP3 tests to `dom.test.ts` (near the AC20 block, ~line 844)
- [ ] Rework `updateStreamChild` (`render.ts:1014`) for in-place patching
- [ ] `vp check --fix` + `vp test`

### Part B1 — `List.each` core API + types (task #2)

- [ ] `packages/core/src/combinator/list.ts` — `LIST` symbol + `List.each` namespace
- [ ] Export `List`, `LIST` from `packages/core/src/combinator/index.ts`
- [ ] `combinator/list.specs.md` (API + E/R typing + identity ACs)
- [ ] `combinator/__type-tests__/list.test-d.ts` (E/R propagation, `by`/`render` typing)
- [ ] `vp run typecheck.type-tests` + `vp check --fix`

### Part B2 — client renderList + reconcileList (task #3, blocked by #2)

- [ ] `listItemStartText`/`listItemEndText` + parse in `shared.ts` / `utilities.ts`
- [ ] `LIST` case in `renderNode` → `renderList`
- [ ] `reconcileList` + `ItemRecord` (per-key persistent `Scope.fork`, `HashMap<K, ItemRecord>`)
- [ ] LIS-based minimal moves (KR5)
- [ ] `client/list.specs.md` (KR/SC/HY ACs + render-once / index-key warning)
- [ ] `client/list.test.ts` (insert/remove/move/reuse, dup keys, `Equal` vs `by`,
      subscription preservation, focus preservation)
- [ ] `playground/recipes/keyed-list/` (`keyed-list.ts` + `keyed-list.readme.md`)
- [ ] `vp check --fix` + `vp test`

### Part B3 — hydration of List regions (task #4, blocked by #3)

- [ ] Server hydratable renderer emits `LIST` region + per-item markers (`packages/dom/src/server/*`)
- [ ] Client `hydrateList` adopts server DOM + reconciles first emission flash-free
- [ ] Hydration tests + `vp check --fix` + `vp test`

## Resume point

Next concrete step: write SP1/SP3 tests in `packages/dom/src/client/dom.test.ts`
(near the AC20 `describe` block, ~line 844), then rework `updateStreamChild` at
`packages/dom/src/client/render.ts:1014` — it currently does unconditional
`removeNodesBetweenMarkers` + `renderNode` + insert; make it read the new value's
shape first and patch in place per SP1–SP4.

## Key reminders

- Persisted keys never re-run `render` (components run once) — reconciliation only
  reuses/moves/inserts/removes DOM; content refresh is via streams inside the item.
- `by: t=>t.id` = identity; `by: (_,i)=>i` = positional (stale-content footgun — warn).
- Default identity = Effect `Equal`/`Hash` (structural for `Data`, reference for plain objects).
- Per-item scopes are `Scope.fork(regionScope)` and PERSIST across emissions (preserve
  subscriptions); closed only on item removal or region teardown.
