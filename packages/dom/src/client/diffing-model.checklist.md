# Diffing Model — Checklist & Status

> Plan: [`diffing-model.plan.md`](./diffing-model.plan.md)
> Approved plan (archive): `~/.claude/plans/last-option-spec-discussion-to-abundant-wall.md`
> Branch: `perf/diffing-model` (currently even with `main`)

## Status summary

Design is locked via spec discussion. **Part A is complete** (scalar same-type patching:
SP1–SP4 in `updateStreamChild`, tests in `dom.test.ts`, `dom.specs.md` AC20 amended).
**Part B1 is complete** (`List.each` core API: `LIST` symbol + combinator in
`packages/core/src/combinator/list.ts`, exports, `list.specs.md`, type tests, and a
`list.test.ts` detection unit test; 284 tests passing). Next is **Part B2**
(client `renderList` + `reconcileList`). Part B3 unstarted.

Follow CLAUDE.md spec → mock → test → implement for each phase.

## Checklist

### Setup

- [x] Explore renderer, combinator API, node model, marker protocol, `Source` type
- [x] Spec discussion → final API (`List.each`, `of`, `by`, render-children shape)
- [x] Write plan (`diffing-model.plan.md`)

### Part A — scalar same-type patching (task #1, done)

- [x] Amend `dom.specs.md` AC20 → SP1–SP4
- [x] Add SP1/SP3/SP4 tests to `dom.test.ts` (new `AC20 SP1/SP3` block after the AC20 block)
- [x] Rework `updateStreamChild` (`render.ts`) for in-place patching (SP1/SP2 text,
      SP3 same-tag element reuse + positional child recursion / wholesale-rebuild fallback,
      SP4 fallback). Scope rotation stays caller-owned (`handleStreamChild`/`hydrateReactive`).
- [x] `vp check --fix` + `vp test` (281 passing)

### Part B1 — `List.each` core API + types (task #2, done)

- [x] `packages/core/src/combinator/list.ts` — `LIST` symbol + `List.each` namespace
      (`SourceValue`/`SourceError`/`SourceContext`/`ItemOf` helpers extract T/E/R from
      the `of` source; `render` constrained to `Node<CE, CR>` so item E/R propagate)
- [x] Export `List`, `LIST` from `packages/core/src/combinator/index.ts`
- [x] `combinator/list.specs.md` (API + E/R typing + identity ACs; render-once footgun)
- [x] `combinator/__type-tests__/list.test-d.ts` (item inference, E/R propagation, `by` typing)
- [x] `combinator/list.test.ts` (detection / descriptor-shape unit test)
- [x] `vp check --fix` + `vp test` (284 passing)

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

Parts A + B1 complete. Next concrete step: **Part B2 — client `renderList` +
`reconcileList`**. Per CLAUDE.md (spec → mock → test → implement), start with
`client/list.specs.md` (KR/SC/HY ACs + render-once / index-key warning), then:

1. `listItemStartText`/`listItemEndText` markers + parse in `shared.ts` / `utilities.ts`
   (reuse `RenderContext.streamIdCounter`, same `MARKER_PATTERN` family).
2. `LIST` case in `renderNode` (beside `FRAGMENT`/`SUSPENSE_BOUNDARY`/`FAILURE_BOUNDARY`)
   → `renderList`. Read `descriptor.props.{of,by,render}`; normalize `of` via
   `Source.toSubscribable`; subscribe to `.changes`. This path must NOT use
   `handleStreamChild`'s close-all scope rotation — it keeps persistent reconciler state.
3. `reconcileList` + `ItemRecord` (`HashMap<K, ItemRecord>`; per-key `scope =
Scope.fork(regionScope)` that PERSISTS across emissions; KR1 dup-key fail, KR2 insert,
   KR3 reuse, KR4 remove, KR5 LIS minimal moves; SC1/SC2 subscription & focus preservation).
4. `client/list.test.ts` + `playground/recipes/keyed-list/`.

Core surface available to import: `List`, `LIST` from `@effect-ui/core`; descriptor
props shape is `{ of, by, render }` (read via `getElementDescriptor`).

## Key reminders

- Persisted keys never re-run `render` (components run once) — reconciliation only
  reuses/moves/inserts/removes DOM; content refresh is via streams inside the item.
- `by: t=>t.id` = identity; `by: (_,i)=>i` = positional (stale-content footgun — warn).
- Default identity = Effect `Equal`/`Hash` (structural for `Data`, reference for plain objects).
- Per-item scopes are `Scope.fork(regionScope)` and PERSIST across emissions (preserve
  subscriptions); closed only on item removal or region teardown.
