# Lazy route components (`Router.lazy`) — Specification

## Overview

A route's **descriptor** (its `segment` and `path`/`query` param schemas) is small and
must be known statically, but its **component** (the render body and everything that
module imports) can be arbitrarily large. Today a route's component is imported eagerly
with its `Router.route(…)` declaration, so a route tree pulls every page's render code
into the initial graph, even though a request renders one leaf.

`Router.lazy` lets a route declare its component as a **lazily-loaded chunk** while
keeping the descriptor eager. The matcher, `buildHttpApi`, and `href` are unchanged; only
the matched leaf's component chunk is fetched, on the server during render and on the
client on navigation.

```ts
// descriptor eager (matchable) — body split into its own chunk:
Router.route("docs/:category/:slug", {
  path: { category: Schema.String, slug: Schema.String },
  component: Router.lazy(() => import("./doc-page").then((m) => m.DocPage)),
});
```

## Feasibility constraint (why the descriptor stays eager)

The client matches a URL to a leaf via the static pattern table compiled from the tree
(`compile.ts` → `matcher.ts`), and the server builds one `HttpApi` endpoint per leaf at
`makeRouter` time (`buildHttpApi`). Both need each leaf's `segment` + param schema
**before** any component loads — otherwise the client would have to download every chunk
just to discover which route matches, defeating the split, and the server could not build
its dispatch API. Therefore the lazy unit is the **component only**. A whole-`RouteNode`
(or subtree) behind an `Effect`/`Promise` is explicitly a non-goal (see below).

This also means the feature needs **no change** to `compile.ts`, `matcher.ts`,
`buildHttpApi`, `href`, or the server/client render paths: a component slot already
returns a `Node`, and the DOM renderer already renders a `Node` whose production is
asynchronous (proven end-to-end by the per-route doc-data split — SSR, hydration, and SPA
navigation all render an async component body flash-free; see
`website/src/lib/docs-split.specs.md`). `Router.lazy` is a typed, ergonomic wrapper over
"a component whose body awaits a dynamic `import()`".

## API

```ts
namespace Router {
  /**
   * Wraps a dynamic-import loader as a component slot. `load` resolves the route's
   * component (a `Component` or a `() => Node` thunk), typically from an `import()` so
   * the module is a separate chunk. The returned slot, when the router invokes it at
   * render time, awaits `load`, then renders the resolved component — adopting the
   * server DOM in place on hydration (flash-free), fetching the chunk on client nav.
   */
  const lazy: <S extends ComponentSlot>(
    load: () => Promise<S>,
  ) => () => Node<Node.Error<SlotNode<S>>, Node.Context<SlotNode<S>>>;
}
```

- `load` returns a `Promise` (matches `() => import("…").then((m) => m.X)`). An
  `Effect`-returning overload MAY be added later; the `Promise` form is primary and is
  wrapped internally in `Effect.promise`.
- The resolved value should be a **`Component`** (`Component.gen` / `Component.make`) —
  which is what `import("…").then((m) => m.X)` yields. A bare `() => Node` thunk loses its
  `E`/`R` channels through the loader `Promise` (contextual widening); wrap one in
  `Component.make`. Either way the loaded value is the shape `component:` already accepts.
- The return is a **zero-arg thunk** `() => Node<E, R>`, not `(props) => Node`. That is the
  one slot shape the tree's `SlotNode` helper can destructure (`() => infer N`), so channels
  propagate through both `makeRoute` **and** `makeLayout` — a lazy **layout** would
  otherwise lose them, since `makeLayout` (unlike `makeRoute`) has no direct-inference
  overload. A zero-arg thunk is still a valid `ComponentSlot`; the router ignores props.
- `Router.lazy(load)` returns a `ComponentSlot`; it drops directly into
  `Router.route({ component })` and `Router.layout({ component })`. `makeRoute` /
  `makeLayout` infer the leaf/layout `E`/`R` from the slot's `SlotNode` exactly as they do
  for an eager component (see below).

## Channel inference (`E`/`R`)

The tree aggregates each node's error (`E`) and requirement (`R`) channels so a sealed
`RouterDef` surfaces precise types (`route-tree.ts`, `TreeE`/`TreeR`). A lazy component
must propagate the **resolved** component's channels, not `unknown`:

- **AC-T1** `Router.lazy(() => import("./p").then((m) => m.P))` yields a slot whose
  `SlotNode` is `Node<E, R>` for the resolved `P`'s `E`/`R`, so a `Router.route` using it
  produces `RouteNode<Path, Query, E, R>` identical to declaring `P` eagerly.
- **AC-T2** A lazy component that reads `Router.params` / a `Docs` service surfaces that
  requirement on the route's `R` (and thus in the tree aggregate), so an unmet
  service is a compile error at `makeRouter`, same as eager.

## Behavior

### Server render (SSR)

- **AC-S1** During the buffered `RouterServer.render`, the matched leaf's lazy slot awaits
  its `load` and renders the resolved component to hydratable HTML. The server has every
  chunk, so this resolves without a network hop; the dynamic-import module cache means a
  repeat within a process loads once.
- **AC-S2** A layout in the matched branch may also be `Router.lazy`; each lazy node in the
  rendered branch is awaited. Nodes **not** in the matched branch are never loaded.

### Hydration

- **AC-H1** The client re-invokes the same lazy slot; it awaits its chunk and **adopts the
  server-rendered DOM in place** — the first (and only) production matches the adopted
  DOM, so nothing is mutated and there is **no flash** (the async-component hydration
  property; `hydrate.specs.md`). The doc body/interactive regions become live once the
  chunk resolves.
- **AC-H2** No Suspense/Boundary is introduced by `Router.lazy`; a fallback flash would
  only occur if the author wraps the lazy component in one, which is their choice.

### Client navigation

- **AC-C1** On `navigate`, the matcher (static, unchanged) resolves the target leaf; the
  outlet re-renders, invoking the target's lazy slot, which fetches its chunk and swaps the
  outlet content once resolved. A route with no lazy nodes navigates synchronously as
  today.
- **AC-C2** A revisit to an already-loaded route is synchronous. `Router.lazy` **memoizes
  its load `Promise` per slot**: the first render triggers the import; every later render
  and back-navigation reuses the resolved module — no second fetch, and (independently) the
  runtime's own `import()` cache dedupes across slots that import the same chunk. The memo
  also means a single render never double-loads even if the renderer evaluates the slot
  more than once.

### Chunk-load failure

- **AC-E1** `load` rejects (offline, or a stale client requesting a chunk removed by a new
  deploy). **Decision (MVP): a rejected `load` is a defect** (`Effect.promise` dies),
  surfaced through the app's normal defect handling — it is a deploy-skew/bug condition,
  not a routing outcome, and keeping it off the `E` channel keeps every lazy route's `E`
  identical to its eager form (AC-T1). The memoized `Promise` (AC-C2) caches the rejection,
  so the route keeps failing until a reload — consistent with the deploy-skew framing (no
  silent retry).
  - **Extension (deferred):** a variant that maps rejection to a tagged
    `RouteChunkLoadError` on the node's `E` channel (catchable by a `Boundary`, enabling a
    "reload for the latest version" fallback). Adds the error to `E`, so it is opt-in
    rather than the default.

## Authoring guidance

To actually split a route, the heavy component must live in a module the lazy `import()`
is the **only** eager path to. Keep the `Router.route(…)` descriptor in an eagerly-imported
file (e.g. `app.ts` or a light `routes/*.ts`), and move the component implementation (and
its heavy deps — `renderHast`, per-page libraries) into a separate module referenced only
through `Router.lazy(() => import("./impl"))`. A descriptor file that still statically
imports the impl gains nothing.

## Preloading (deferred, cross-referenced)

Correctness holds without preload (SSR content is visible; the chunk resolves shortly
after). As in the doc-data split, a `modulepreload` of the matched leaf's chunk (server
inject on first paint; hover/viewport prefetch on the client) is a **latency
optimization** left to a follow-up once the manifest→chunk mapping is wired. Non-goal here.

## Non-goals

- **Lazy descriptor / lazy subtree.** A child that is `Effect<RouteNode>` /
  `Promise<RouteNode[]>`, or a `Router.lazy("prefix", () => import(...))` that defers a
  whole subtree, is out of scope: it would require the matcher/`httpApi` to resolve chunks
  before matching. (If wanted later, it must carry a **static path prefix + eager param
  schema** for the covered subtree so matching stays chunk-free; that is a separate spec.)
- No change to `matcher.ts`, `compile.ts`, `buildHttpApi`, `href`, or the render paths.
- No Suspense/fallback machinery baked into `Router.lazy`.
- No `modulepreload` wiring in this pass.

## Acceptance criteria (summary)

- **AC1** `Router.lazy(load)` is a `ComponentSlot` accepted by `Router.route` and
  `Router.layout` with no other API change.
- **AC2** A lazy route's component is emitted as a distinct chunk; only the matched
  branch's chunks load (server render + client nav).
- **AC3** Direct-load SSR of a lazy route is flash-free on hydration (AC-H1) — browser test:
  server-render → adopt → assert content present and its DOM node identity preserved across
  the hydrate tick.
- **AC4** Client navigation to a lazy route renders once its chunk resolves; a revisit is
  synchronous (AC-C2).
- **AC5** `E`/`R` of a lazy route equal those of the same component declared eagerly
  (AC-T1/AC-T2) — a type test asserts both the positive (channels preserved) and the
  negative (unmet requirement is a compile error).
- **AC6** The matcher, `buildHttpApi`, and `href` are byte-for-byte unchanged; a lazy and
  an eager route with the same descriptor match and build `href` identically.
- **AC7** A rejected chunk load is a defect (AC-E1), not a silent 404 or a hang.

## Test plan (per TDD: spec → mock → type-tests → unit → e2e)

- **Type tests** (`__type-tests__`): AC-T1/AC-T2 (channel preservation + negative
  requirement error), and that `Router.lazy(...)` is assignable to `component:`.
- **Unit** (node): `Router.lazy` slot invoked → awaits loader → returns the resolved
  component's node; loader called once across repeat invocations (memo via module cache is
  runtime; unit uses a counting loader).
- **Browser e2e**: AC3 (flash-free direct-load hydration) and AC-C1/AC-C2 (nav loads the
  chunk, revisit synchronous), mirroring the existing router-ssr example browser tests.
- **Example**: a `Router.lazy` usage in `examples/*` (or convert a doc route in
  `website/`), with a co-located `*.browser.test.ts`, per the examples rule.
