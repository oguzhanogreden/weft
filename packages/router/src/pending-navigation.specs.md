# Pending navigation (`Router.navigating`, deferred commit) — Specification

## Overview

On client SPA navigation to a route whose component (or a layout in its matched
branch) is `Router.lazy`, the outlet region goes **blank** from the moment of the
click until the lazy chunk's dynamic `import()` resolves. The cause is a
**commit-then-fill** sequence: `navigate` moves the URL ref synchronously, the
outlet's reactive stream immediately swaps in the new leaf node, and that node is an
async `Effect` (it awaits the chunk import) — so the DOM renderer tears the old
content down (`updateStreamChild` SP4, `@weftui/dom` `render.ts`) and renders empty
comment markers, filling them only when the import resolves a full network round-trip
later.

Mature routers (React Router data mode, Vue Router, Next App Router) instead **defer
the route commit until the target's code resolves, keeping the previous view mounted
during the pending phase**, then swap atomically. This spec brings Weft to that model
for the **code (chunk) dimension**: `navigate` resolves the matched branch's
`Router.lazy` chunk(s) **before** committing the URL and the match, so the old outlet
stays mounted for free and the swap is a single synchronous tick with no blank.

It also introduces a reactive **`Router.navigating`** signal so an app can render a
top progress bar / pending styling during the resolve window.

## Feasibility (why this needs no matcher/renderer change)

Two properties of the existing pipeline make this a router-local change:

1. The outlet's `levelStream` (`outlet.ts`) is driven by `currentMatch.changes`,
   which is `urlRef.changes` mapped through the static matcher. **Nothing drives the
   stream until the URL ref is set**, so delaying that set until the chunk is loaded
   keeps the previous `renderLevel` node mounted with zero additional machinery.
2. `lazyComponent` already memoizes its load `Promise`. Adding a synchronous
   `resolved` memo lets the slot return a **synchronous** node once its chunk is in
   memory. `renderNode`'s sync probe (`Effect.runSyncExit`) then succeeds, so
   `updateStreamChild` renders the new content **inline** in the same tick that
   removes the old — an atomic swap.

Therefore: **no change to `matcher.ts`, `compile.ts`, `buildHttpApi`, `href`, or the
DOM render paths** (mirrors `lazy-component.specs.md` AC6). The lazy unit remains the
component only.

## API

### `Router.lazy` preload seam (internal)

`lazyComponent` (exposed as `Router.lazy`) attaches an internal, branded `preload`
capability to the thunk it returns, and gains a synchronous post-load render path:

```ts
const PreloadSlot: unique symbol; // Symbol.for("@weftui/router/preload")
interface Preloadable {
  readonly [PreloadSlot]: () => Promise<unknown>;
}
/** Reads the preload capability off a slot, or `undefined` for an eager slot. */
function getPreload(slot: ComponentSlot): (() => Promise<unknown>) | undefined;
```

- The `preload()` runs the **same** memoized `load()` the render path uses (`cached
??= load()`) and records the resolved component in a `resolved` memo. It is
  idempotent and shares the single fetch (AC-C2 preserved — no double load).
- After `resolved` is populated, invoking the slot returns the resolved component's
  node **synchronously** (`resolved({})`), rather than the `Effect.promise` body.
- **Only `preload()` populates `resolved`** — the async render body does not. Client
  navigation always `preload()`s the matched branch before commit (so the post-commit
  render is the sync path), whereas SSR and **hydration** render through the async body
  with `resolved` still undefined, preserving flash-free adopt-in-place hydration
  (`lazy-component.specs.md` AC-H1). Populating `resolved` from the render body would make
  a server-then-client render over the _same slot instance_ hydrate synchronously and
  mismatch the adopted DOM.
- `PreloadSlot` / `getPreload` / `Preloadable` are **internal** to `@weftui/router`
  (consumed by `RouterLive`), not public API.

### `Router.navigating`

```ts
type NavState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Navigating"; readonly to: string };

// on the Router service:
readonly navigating: Subscribable.Subscribable<NavState>;

// optional accessor, mirroring params/queryStream:
namespace Router {
  const navigatingStream: Effect.Effect<Subscribable.Subscribable<NavState>, never, Router>;
}
```

`NavState` is exported from `@weftui/router` and `@weftui/router/client`. Reading
`navigating` is optional; an app that ignores it is unaffected.

## Behavior

### Client navigation

- **AC-N1 (deferred commit).** On `navigate(to)`, the matched branch's `Router.lazy`
  preloads (leaf component + each layout in `leaf.layoutChain`) are collected via
  `getPreload` and awaited **before** the URL is committed (`history.pushState` /
  `replaceState`) and before `SubscriptionRef.set(urlRef)`. The previous outlet
  content stays mounted throughout the resolve window — **no blank**.
- **AC-N2 (atomic swap).** Once preloads resolve, the URL and the match commit in the
  same effect; the outlet re-renders with the target leaf whose `Router.lazy` slot now
  returns a synchronous node, so the DOM swap removes the old and inserts the new in a
  single tick.
- **AC-N3 (fast path unchanged).** A navigation whose matched branch has **no**
  `Router.lazy` node collects zero preloads and takes a synchronous path identical to
  the pre-feature behavior: commit URL, set ref. `navigating` never leaves `Idle`,
  and eager-route apps are byte-for-byte unaffected.
- **AC-N4 (revisit synchronous).** A revisit to an already-loaded lazy route has its
  `resolved` memo populated, so `preload()` resolves on a microtask and the commit is
  effectively immediate (AC-C2).

### `navigating` state machine

- **AC-N5.** For a pending (lazy) navigation, `navigating` transitions
  `Idle → Navigating{ to }` at the start of the resolve window and back to `Idle` on
  commit. For a fast-path (eager) navigation it stays `Idle` (no emission).
- **AC-N6.** A component may read `Router.navigating` / `Router.navigatingStream` to
  render pending UI (e.g. a top progress bar) that is visible only during the window.

### Latest-wins (rapid navigations)

- **AC-N7.** Each navigation captures a monotonic token. If a newer navigation starts
  while an older one is still resolving, only the **newest** commits: a superseded
  navigation, when its preload finally resolves, does **not** `pushState` or set the
  URL ref, and does **not** reset `navigating` (the newer navigation owns it). The
  superseded fetch still completes (promises are not cancellable) and populates the
  shared memo, so a later navigation there is instant.

### Back / forward (popstate)

- **AC-N8.** `popstate` (browser back/forward) to a lazy route resolves the target
  branch's preloads before setting the URL ref, so back-navigation is also blank-free.
  The URL is **not** pushed (the browser already moved it); the ref is set after the
  preload. popstate carries its own latest-wins token. Because the browser moves the
  URL bar immediately, its content lags the (already-moved) URL during the window —
  the same tradeoff React Router data mode has.

### Chunk-load failure

- **AC-N9.** A rejected preload is a **defect** (`Effect.promise` dies), consistent
  with `lazy-component.specs.md` AC-E1 — it propagates through the navigating fiber
  (the link interceptor's `Runtime.runFork`, or the caller's runtime) and is surfaced
  by normal defect handling; it never hangs. `navigating` is reset to `Idle` on
  failure (guarded by the latest-wins token). The memo caches the rejection, so the
  route keeps failing until reload (deploy-skew framing).

### Server

- **AC-N10.** Server render is buffered (`RouterServer.render`), so `navigating` is a
  client-only concern. The server `Router` service supplies a constant `Idle`
  `navigating` so the service shape type-checks on both sides.

## Scope

- **In scope (this pass): code / chunk preload only.** The `Router.lazy` route chunk
  (and any lazy layout chunk) in the matched branch.
- **Out of scope (deferred): data preload.** **Superseded by
  `resolve-before-commit.specs.md`** — the leaf's component effect (its data
  included) now resolves pre-commit, so neither follow-up option sketched below
  should be implemented independently. Kept for the record:
  A component body may await its own data
  after its chunk loads (e.g. the website's `docs.load` → `Effect.promise(loadTree)`,
  itself a lazy chunk). Chunk-only preload does not cover that, so a **shorter**
  data-fetch blank can remain on first visit to a data route. Covering it is a
  follow-up via either:
  - a route-level awaitable `preload`/loader that attaches the **same** `PreloadSlot`
    brand, so `collectPreloads` awaits it alongside the chunk with **zero change** to
    the `navigate` flow; or
  - deferred-commit rendering that keeps the previous DOM until the whole subtree
    (chunk + data) first settles.
- **Non-goals.** No Suspense/fallback machinery (the deferred commit removes the blank,
  so `lazy-component.specs.md` AC-H2's "no fallback" is now moot rather than a
  limitation). No `modulepreload`/hover-prefetch wiring (a separate latency
  optimization). No change to the matcher, compile, `buildHttpApi`, `href`, or the DOM
  render paths.

## Acceptance criteria (summary)

- **AC1** Navigation to a lazy route resolves its chunk(s) before commit; the previous
  outlet content stays mounted and the swap is blank-free (AC-N1/AC-N2).
- **AC2** Eager-route navigation is unchanged and overhead-free; `navigating` stays
  `Idle` (AC-N3).
- **AC3** `Router.navigating` reports `Navigating{to}` during a pending navigation and
  `Idle` otherwise; readable via `Router.navigatingStream` (AC-N5/AC-N6).
- **AC4** Rapid successive navigations commit latest-wins; a superseded navigation
  never commits or resets state (AC-N7).
- **AC5** popstate to a lazy route is blank-free and never double-pushes (AC-N8).
- **AC6** A rejected chunk load is a defect that resets `navigating`, never a hang
  (AC-N9); consistent with `lazy-component.specs.md` AC-E1.
- **AC7** The matcher, compile, `buildHttpApi`, `href`, and DOM render paths are
  unchanged (mirrors `lazy-component.specs.md` AC6).

## Test plan (spec → mock → type-tests → unit → e2e)

- **Type tests** (`__type-tests__`): the `Router` service `Type` carries `navigating:
Subscribable<NavState>`; `NavState` union shape; the server `serverRouter` result is
  assignable to `Router["Type"]`.
- **Unit** (`lazy-component.test.ts`): `getPreload(slot)` resolves and populates the
  memo so the next slot invocation returns a synchronous node
  (`Effect.runSyncExit` succeeds); a counting loader runs once across preload + render
  (AC-C2 / AC-N4); an eager slot has no preload (`getPreload` → `undefined`).
- **Unit** (`client/router-live.test.ts`, JSDOM): deferred-loader nav holds
  `currentMatch` + URL until resolution with `navigating` `Idle → Navigating → Idle`
  (AC-N1/AC-N5); non-lazy nav is synchronous with no `Navigating` emission (AC-N3);
  latest-wins across two deferred navs (AC-N7); preload rejection dies and resets
  `navigating` (AC-N9).
- **Browser e2e** (`examples/router-ssr/src/pending-navigation.browser.test.ts`): with
  a controllable-delay lazy fixture, a `MutationObserver` on the outlet asserts the
  content region is **never emptied** across the transition (old content present until
  the new commits) and that a `Router.navigatingStream` reader shows the pending
  indicator during the window (AC1/AC3). Revisit is synchronous (AC-N4).
- **Example**: a top progress bar reading `Router.navigating` wired into the
  `router-ssr` example, with a co-located browser test (examples rule).
