# Resolve-before-commit navigation (component-effect deferred commit) — Specification

## Overview

`pending-navigation.specs.md` made client navigation **deferred-commit for code**:
the matched branch's `Router.lazy` chunk(s) resolve before the URL commits, so the
previous view stays mounted during the fetch. It explicitly deferred the **data**
dimension: a leaf whose component body awaits its own data (e.g. the website's
`DocsPage` → `yield* docs.load(...)` → `Effect.promise(loadDocTree)`) still commits
first and fills later — the outlet region is torn down at commit and stays **blank
for a full network round-trip** (measured: ~1 RTT on first visit to a doc; see the
investigation notes referenced under Motivation).

Mature data routers (React Router data mode, TanStack Router, SvelteKit) await
route data **before** committing the navigation, keeping the old view mounted, with
an opt-in streaming escape hatch per value. Weft adopts the same model — but
**without a route-level loader**. The package's route model is
*component-as-handler* (`router.specs.md`): there is no per-route data schema or
loader, and this spec does not add one. Instead it uses the property loaders were
invented to work around not having: **a Weft component is already an `Effect`**.

**Design:** on client navigation, after the existing chunk preloads, `navigate`
**runs the matched leaf's component effect to completion pre-commit** — under the
live runtime context, with the *target* match staged — stashes the resulting
`Exit`, and only then commits the URL. The outlet's leaf emission consumes the
stashed, already-resolved node **synchronously**, so the swap is atomic: the old
content is removed and the new content inserted in the same tick, with no blank
and no intermediate skeleton.

The dual model falls out with zero new authoring API:

- **`yield*` in the component body** → commit-blocking. Navigation waits; the old
  page stays mounted; `Router.navigating` reports the window.
- **An `Effect`/`Stream` placed as a child node** → streaming. Commits immediately
  and fills in place after mount (`docs/how-to/load-async-data.md` pattern,
  `Boundary.rpc` client-first mount, `Boundary.suspend`).

Where the author puts the await *is* the blocking/streaming choice — the exact
split React Router expresses as "await in loader vs return a promise", relocated
into the render tree where Weft wants data to live.

### Universal invariant

This spec completes one sentence that holds in every environment:

> **A component's own effect always completes before its node appears.**

- **Server:** the buffered render already awaits the body — unchanged.
- **Hydrate:** the async body renders through the adopted SSR DOM — unchanged
  (`lazy-component.specs.md` AC-H1).
- **Client navigation:** the only place a "commit" exists, and the only place this
  spec changes behavior.

No loader means no "does the loader run on the server?" question, no result
serialization, and no duplicate data path next to SSR — the pre-run executes on
the client against client services (`Docs`, `AppRpcClientTag`, …), exactly what a
post-commit render would have used.

## Motivation (measured)

Playwright against the prerendered website (`dist/static`, 300 ms emulated
latency), navigating `/docs/tutorial/01-your-first-app` → `02-reactivity`:

| Case                      | Outlet blank window                  |
| ------------------------- | ------------------------------------ |
| First visit (tree fetch)  | **318 ms** (≈ the full network RTT)  |
| Revisit (memoized tree)   | ~6 ms blank + ~25 ms progressive pop-in |

The first row is the data gap this spec closes. The second row (teardown-then-
async-fill for an *already-synchronous* leaf) is also fixed as a side effect: the
stashed node is a plain resolved descriptor, so the leaf swap renders inline
(`updateStreamChild` SP4 removes and inserts in one tick — no painted blank).

## Feasibility (why this is router-local)

1. **The navigate fiber has the context the renderer's probe lacks.** The DOM
   renderer's sync probe (`render.ts` `Effect.runSyncExit(node)`) runs with an
   empty context, so any service-reading component falls to the fork-and-fill
   path. `navigate` runs inside the `RouterLive` layer's runtime — `Router`,
   `AppRpcClientTag`, and the app `context` layer are all present — so it can
   execute the leaf effect for real, pre-commit.
2. **The outlet already re-emits the leaf per URL change** (`outlet.ts` `keyOf`,
   ` leaf:${match.url}`). Having that emission return a pre-resolved node instead
   of invoking the slot is a local change to `renderLevel`; the emission keying,
   layout dedupe, matcher, `compile`, `buildHttpApi`, `href`, and **all
   `@weftui/dom` render paths are unchanged**.
3. **Chunk preload composes, not duplicates.** The existing preload stage
   (`pending-navigation.specs.md` AC-N1) still runs first — it is what loads
   *layout* chunks (layouts are not pre-run, see AC-R9) and populates the lazy
   slot's `resolved` memo, so the leaf pre-run enters the slot's synchronous path
   rather than re-awaiting the import.

## API

**No new public API.** `NavState`, `Router.navigating`, `Router.lazy`, the route
authoring surface, and the sealed router types are all unchanged. Two internal
seams are added, mirroring the internality of `PreloadSlot`:

### Staged match (internal)

The pre-run executes the leaf slot exactly as `renderLevel` would — handler-arg
props `{ path: match.path, query: match.query }` from the **target** match — with
one addition: the effect runs under a **staged `Router` view** whose
`currentMatch.get` resolves to the target match (the URL ref has not moved yet).

- One-shot reads during the pre-run (`Router.params`, `Router.query`, direct
  `currentMatch.get`) therefore see the **target** match (AC-R4).
- Reactive accessors (`Router.paramsStream`, `currentMatch.changes`) hand back
  subscribables whose subscriptions occur at render/mount time — post-commit —
  so they observe the committed match onward. Only `get` is staged; `changes`
  delegates to the live ref.
- `navigate`, `httpApiClient`, and `navigating` on the staged view delegate to
  the real service.

### Resolved-commit stash (internal)

```ts
/** Symbol.for("@weftui/router/resolved-commit") — internal, not public API. */
const ResolvedCommit: unique symbol;
interface ResolvedCommitSlot {
  [ResolvedCommit]?: {
    readonly url: string; // the exact committed `path + search`
    readonly exit: Exit.Exit<Renderable, unknown>; // the pre-run's outcome
  };
}
```

The client `Router` service instance carries this mutable slot. `navigate` writes
it immediately before committing the URL ref; the outlet's leaf `renderLevel`
branch, when `match.url` equals the stashed `url`, **consumes it exactly once**
(clears the slot) and returns:

- `Exit.Success` → the resolved node, synchronously — the atomic swap.
- `Exit.Failure` → `Effect.failCause(cause)` — the failure replays through the
  normal render error path (nearest `Boundary`, `RouterNotFound` → the router's
  404 boundary) **without re-running the component** (AC-R7).

The server router and the hydrate path never populate the slot, so `renderLevel`
falls through to today's slot invocation everywhere except a client navigation.
Stashing the `Exit` (not just the node) is what makes the component body
**exactly-once** on both the success and the failure path.

## Behavior

### Client navigation

- **AC-R1 (deferred commit, data included).** On `navigate(to)` whose target is a
  `Matched` leaf: after the branch's chunk preloads (AC-N1, unchanged), the leaf's
  component effect is executed to completion **before** `pushState`/`replaceState`
  and before the URL ref is set. The previous outlet content stays mounted for the
  entire window — chunk fetch **and** data fetch.
- **AC-R2 (atomic swap, exactly-once).** The commit stores the pre-run `Exit` in
  the resolved-commit stash; the outlet's leaf emission consumes it and renders
  the already-resolved node inline in the same tick the old content is removed.
  The component body runs **exactly once** per navigation — never re-invoked
  post-commit on either the success or the failure path.
- **AC-R3 (synchronous fast path preserved).** A leaf whose effect resolves
  synchronously (eager component with no async work; lazy slot revisit with both
  memos warm and sync body) commits in the same tick, and `navigating` **never
  leaves `Idle`** — the pre-feature eager behavior (AC-N3) is preserved
  observationally: no `Navigating` flicker for sync navigations. Implementation
  may probe synchronously first (the context is available in the navigate fiber)
  and fall back to the async pre-run path on suspension.
- **AC-R4 (staged params).** During the pre-run, handler-arg props and one-shot
  `Router.params` / `Router.query` reads decode the **target** match. Reactive
  subscriptions made after mount observe the committed match. (A body that
  *subscribes and reads* mid-pre-run sees snapshot semantics: the staged `get`,
  the live `changes` — documented, not prevented.)
- **AC-R5 (`navigating` covers the whole window).** `Router.navigating`
  transitions `Idle → Navigating{ to }` when an async resolve window opens
  (chunk preload and/or component pre-run) and back to `Idle` on commit — one
  signal for both dimensions. `NavState` is unchanged; existing progress-bar code
  (`docs/how-to/show-navigation-progress.md`) works unmodified and now also
  covers data windows.
- **AC-R6 (latest-wins, now interruptible).** Each navigation's pre-run runs in
  its own fiber guarded by the existing monotonic token. A superseded
  navigation's pre-run is **interrupted** (Effect interruption — finalizers of
  any scoped work run); it never commits, never writes the stash, and never
  resets `navigating`. Chunk preloads keep their non-cancellable shared-memo
  semantics (AC-N7) — only the component pre-run is interruptible.
- **AC-R7 (failure = commit + replay, single-run).** A pre-run that fails —
  typed error (e.g. `RouterNotFound` via `notFound()`) or defect — still
  **commits the URL** (the user navigated; the address must move), stashes the
  failure `Exit`, and resets `navigating`. The outlet replays the `Exit` at
  render, so the error surfaces exactly where a post-commit render would have
  surfaced it: `RouterNotFound` reaches the router's 404 boundary, other typed
  errors reach the nearest enclosing `Boundary`, defects propagate as defects.
  The navigate fiber itself does not fail from a component pre-run. (A rejected
  **chunk** preload keeps AC-N9 semantics unchanged: defect in the navigating
  fiber.)
- **AC-R8 (popstate).** Back/forward pre-runs the target leaf the same way before
  setting the URL ref (no push — the browser already moved). Blank-free
  back-navigation now includes the data window. Latest-wins token shared with
  `navigate` (AC-N8 unchanged otherwise).
- **AC-R9 (leaf only; layouts excluded this pass).** Only the matched **leaf**
  component is pre-run. Layout components in the branch get their **chunks**
  preloaded (existing behavior) but their effects still execute at render, post
  commit. Rationale: unchanged layouts never re-render across navigations
  (`keyOf` dedupe) so the common case has no layout work at all; newly-mounted
  layouts are typically synchronous chrome once their chunk is loaded; and
  pre-running layouts would couple `navigate` to the outlet's per-level dedupe
  logic. A branch whose *new* layout does real async work in its body may still
  fill late — follow-up if it bites in practice.
- **AC-R10 (not-found fast path).** A navigation matching no route pre-runs
  nothing (there is no leaf) and commits synchronously; the 404 page renders as
  today.
- **AC-R11 (streaming children unaffected).** Pre-run resolution awaits the
  component's **own** effect only. `Effect`/`Stream` children inside the returned
  node, `Boundary.rpc` regions, and `Boundary.suspend` fallbacks render and fill
  post-commit exactly as today — that *is* the opt-in streaming half of the model.

### Pre-run lifetime (scope ownership)

- **AC-R12.** Each pre-run executes in a **navigation-owned scope**. A superseded
  or failed pre-run's scope closes when it is interrupted / its `Exit` is
  replayed. A committed pre-run's scope is retained by the router and closed when
  a **later** navigation commits a different leaf emission (the region that
  consumed the node has been replaced by then), or when the `RouterLive` layer's
  scope closes. Component bodies that only allocate unscoped state
  (`SubscriptionRef.make` etc. — the overwhelmingly common case) are unaffected
  by scope timing.

### Server / hydrate

- **AC-R13.** `RouterServer.render` and hydration are byte-for-byte unchanged: the
  stash is never populated outside a client navigation, the staged view is never
  constructed, and the server `Router` service needs no new members. The lazy
  slot's `resolved`-memo hydration guard (`lazy-component.specs.md` AC-H1) is
  unaffected.

## Scope

- **In scope:** client `navigate` + `popstate` pre-run of the matched leaf
  component effect; `Exit` stash + outlet consumption; staged match view;
  interruptible latest-wins; `navigating` window widening; documentation set
  below.
- **Out of scope / non-goals:**
  - **Layout effect pre-run** (AC-R9 rationale; revisit on evidence).
  - **Whole-subtree settle** (await nested streaming children before commit) —
    that is renderer territory and intentionally *not* wanted: children are the
    streaming escape hatch.
  - **Pending-UI thresholds** (TanStack `pendingMs`-style anti-flash delay) —
    expressible in userland over `Router.navigating` (e.g. CSS
    `transition-delay`); a built-in belongs to a UI-layer follow-up if ever.
  - **Hover/intent prefetch and `modulepreload` hints** — latency optimizations,
    orthogonal.
  - **Navigation timeout** — a hung data effect holds the old page and a
    permanent `Navigating` state, exactly like React Router; authors own
    timeouts (`Effect.timeout`) in their data effects.
  - **No matcher / compile / `buildHttpApi` / `href` / `@weftui/dom` changes.**

## Acceptance criteria (summary)

- **AC1** Navigation to a leaf with an async component body resolves chunk(s)
  **and** the body pre-commit; the previous content stays mounted; the swap is a
  single synchronous tick with no blank and no skeleton (AC-R1/AC-R2).
- **AC2** The component body executes exactly once per navigation, success or
  failure (AC-R2/AC-R7).
- **AC3** Synchronous navigations are observationally unchanged; `navigating`
  stays `Idle` (AC-R3, preserving AC-N3).
- **AC4** One-shot param/query reads during pre-run see the target match
  (AC-R4).
- **AC5** `Router.navigating` spans the combined chunk+data window with the
  existing `NavState` shape (AC-R5).
- **AC6** Rapid navigations: latest wins; superseded pre-runs are interrupted and
  never commit (AC-R6).
- **AC7** Pre-run failures commit the URL and replay through normal render error
  handling — `notFound()` still yields the 404 page (AC-R7).
- **AC8** popstate is blank-free including data, with no double-push (AC-R8).
- **AC9** Server render and hydration are unchanged (AC-R13).
- **AC10** The website's doc→doc navigation, unmodified, no longer empties the
  content region on first visit to a doc (validation target — see Test plan).

## Test plan (spec → mock → type-tests → unit → e2e)

- **Type tests:** none required — no public type surface changes. (Compile-time
  guard that the internal stash/staged-view types do not leak into the sealed
  `Router` public type may be asserted in existing `__type-tests__` if convenient.)
- **Unit — `client/router-live.test.ts` (JSDOM):**
  - Async-body leaf nav holds URL + `currentMatch` until the body resolves;
    `navigating` `Idle → Navigating → Idle` (AC-R1/AC-R5).
  - Body execution counter: exactly one run per navigation, success and failure
    paths (AC-R2/AC-R7).
  - Sync-body leaf nav commits without a `Navigating` emission (AC-R3).
  - A leaf reading `Router.params` during pre-run decodes the **target** URL's
    params (AC-R4).
  - Latest-wins across two async pre-runs: the superseded fiber is interrupted
    (observe via `Effect.onInterrupt`), only the newest commits (AC-R6).
  - Failing pre-run (`notFound()` and a defect fixture): URL commits,
    `navigating` resets, stash carries the failure `Exit` (AC-R7).
  - popstate variant of the first case (AC-R8).
- **Unit — `outlet.test.ts` (or co-located in `router-service.test.ts`):**
  - `renderLevel` consumes a matching stash exactly once and returns the node
    synchronously; a second emission for the same URL falls back to slot
    invocation; a stale stash (URL mismatch) is ignored.
  - A stashed failure `Exit` renders as a failing effect (boundary replay path).
- **Browser e2e — `examples/router-ssr`:** extend the pending-navigation fixture
  with a **controllable-delay data effect in the leaf body** (not just a delayed
  chunk): a `MutationObserver` on the outlet asserts the content region is never
  emptied across the transition; the pending indicator is visible during the
  window; revisit is synchronous (AC1/AC3/AC5). Examples rule: co-located
  `*.browser.test.ts`, `vite-plus/test` globals.
- **Browser e2e — `website/src/__tests__/website.browser.test.ts`:** add the AC10
  assertion — navigate between two docs with a `MutationObserver` on `main`,
  assert no mutation record leaves the article empty (this encodes the measured
  318 ms regression as a permanent test).

## Documentation updates (part of this feature's definition of done)

1. **`packages/router/router.specs.md`** — *Route model — component-as-handler*
   section: add that on client navigation the leaf's component effect resolves
   **before** the commit (component-as-loader corollary), and state the dual
   model: body `yield*` = commit-blocking, child `Effect`/`Stream` = streaming.
   Reiterate: still no per-route loader/schema.
2. **`packages/router/src/pending-navigation.specs.md`** — *Scope → Out of scope
   (deferred): data preload*: mark as **superseded by this spec** with a pointer
   (`resolve-before-commit.specs.md`), so the follow-up options listed there are
   not implemented independently.
3. **`docs/reference/router.md`** —
   - `Router.lazy` section (deferred-commit bullet): widen "the chunk resolves
     before the URL commits" to "the chunk **and the leaf component's own
     effect** resolve before the URL commits".
   - `Router.navigating` section: the window now spans chunk + leaf-effect
     resolution; note that synchronous resolutions never emit `Navigating`.
   - New subsection **"Blocking vs streaming data"** documenting the dual model
     with a short example (body `yield*` vs child effect), cross-linking
     `load-async-data` and `load-data-with-rpc`.
4. **`docs/how-to/split-routes-lazily.md`** — "Blank-free navigation" bullet:
   same widening as the reference; keep the `Router.navigating` pointer.
5. **`docs/how-to/show-navigation-progress.md`** — intro paragraph: the pending
   window includes route **data** (an async component body), not only the chunk;
   the example needs no code change. Optionally add the userland anti-flash
   threshold note (CSS `transition-delay` on the progress bar).
6. **`docs/how-to/load-async-data.md`** — add a section **"Blocking on
   navigation vs streaming in place"**: putting the await in a route component's
   body defers the navigation commit (old page stays mounted, `Router.navigating`
   reports it); keeping the `Stream.concat` loading-placeholder pattern inside a
   child streams it in after commit. State when to choose which.
7. **JSDoc** (enforced by the "all exported symbols" rule where public):
   `RouterLive` / the `commitTo` internal comment block, `outlet.ts`
   `renderLevel`, `lazyComponent`'s deferred-commit comment, and
   `Router.navigating`'s JSDoc in `router-service.ts` — all currently say
   "chunk(s)"; widen to chunk + leaf effect and reference this spec by filename.
8. **Website** — no code changes (`yield* docs.load` is already in the right
   place); the only website touch is the AC10 browser test above.
