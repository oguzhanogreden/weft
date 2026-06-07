# Boundary.server — Core API Spec

## Overview

`Boundary.server` is a universal server/client render boundary: a region that is
byte-identical on server and client, where the **server** runs a `load` effect
(with server-only services supplied via `provide`), serializes the result inline,
and the **client** replays that serialized result during `hydrate` — never running
`load`. It gives a component a server-only data dependency while staying co-located
in the universal tree.

After hydration the region is **no longer inert**: the serialized result seeds a
live, reactive `Resource<A>` handed to `render`, and the client can **refetch** the
same data on demand. Refetch is **endpoint-backed** — it never runs `load` on the
client. Each boundary registers its `load` under a required, stable `id`; the
router exposes a same-origin data endpoint (`GET /_eui/data`) that re-runs the
registered `load` server-side and returns the `schema`-encoded result, which the
client decodes and pushes into the resource so `render`'s subtree patches in place.
One `load` definition therefore serves both the SSR snapshot and client refetch.

Like the other boundaries, `Boundary.server` returns a plain descriptor
`{ type, props }` (tagged with the {@link SERVER_BOUNDARY} symbol) built via
`elementNode`, so the renderer detects and handles it synchronously via the
`{ type, props }` branch without executing the node.

This spec covers the **core** surface: the descriptor, the `Boundary.server`
signature and its channel algebra, and the `ServerTag` / `AssertNoServerOnly`
brand. The renderer behaviour (SSR emit, hydrate replay) is spec'd alongside the
DOM package; this file states the contract those renderers must honour.

### Scope

- **Success serialization + replay** (v1) **and typed-failure replay** (v2). A
  successful `load` is encoded via `schema` and replayed on the client; a typed
  `load` **failure** (`ELoad`) is encoded via `failure` and re-raised on the
  client into the nearest enclosing failure `Boundary`, reproducing the same
  fallback DOM the server rendered. Both are **replay, never retry** — `load`
  never runs on the client.
- **Endpoint-backed client refetch** (phase 3). After a successful SSR hydrate the
  client can re-fetch the data via the router's same-origin data endpoint and
  update the rendered subtree in place. The endpoint re-runs the registered `load`
  **on the server**; the client never runs `load` (so `AssertNoServerOnly` still
  holds). Refetch requires the boundary to carry a required `id` (the registry +
  endpoint key) and the router's data endpoint to be mounted.
- **Out of scope:** a `load` **defect** (a `Die`, not an expected `ELoad`) is not
  replayed — it has no `Cause.failureOption`, so no failure payload is emitted and
  it propagates as before (server renders the enclosing fallback; the client
  hydrate produces a recoverable mismatch). **Client-first mount** of a
  `Boundary.server` with no SSR payload is out of scope for this phase: refetch is
  only available after an SSR hydrate seeds the resource; reach for
  `Boundary.suspend` for client-first data. Progressive/**streamed `load`** also
  remains deferred (see below).

---

## Acceptance Criteria

### Descriptor

1. `Boundary.server(props, render)` returns a plain object `{ type: SERVER_BOUNDARY, props }`
   carried on the node via `elementNode` — readable through `getElementDescriptor`
   **without running the node** (and therefore without running `load`).
2. `props` contains:
   - `id: string` — **required**, stable identity of the boundary. It is the key
     under which `load`/`provide`/`schema`/`failure` are registered (see AC-18) and
     the key the client refetch passes to the data endpoint. Author-supplied so it
     is stable across the SSR render and any later refetch, and across server
     processes/instances.
   - `load: () => Effect.Effect<A, ELoad, RServer>` — a **thunk** (defers
     construction so `load` is built/run only on the server)
   - `provide?: Layer.Layer<RServer>` — discharges `load`'s server-only
     requirements; **required when `RServer ≠ never`**, omittable when `load` has
     no requirements (defaults to `Layer.empty`)
   - `schema: Schema.Schema<A, any>` — the wire contract for `A`, used for both the
     inline SSR payload and the refetch endpoint envelope
   - `failure?: Schema.Schema<ELoad, any>` — the wire contract for a typed `load`
     failure; **required when `ELoad ≠ never`**, omittable when `load` cannot fail
   - `render: (resource: Resource<A>) => C` — builds the subtree from a reactive
     `Resource<A>` (see AC-17), **not** a bare `A`.
3. The `SERVER_BOUNDARY` symbol is exported from `@effect-ui/core` for renderers.

### Signature / channel algebra

4. Output type is `Node<Node.Error<C> | ELoad, Node.Context<C>>`:
   - The error channel is `render`'s error union plus `ELoad`.
   - The requirement channel is exactly `render`'s `R` — **untouched**.
5. `RServer` is **absent** from the output requirement channel: `provide` consumes
   it at construction (it feeds only `load`, never `render`), so no un-discharged
   server requirement can escape into `R`.
6. `provide` is **required when `RServer ≠ never`** and **omittable when `RServer`
   is `never`** (a conditional intersection on the signature, mirroring `failure`).
   When omitted it defaults to `Layer.empty`, so a dependency-free `load` need not
   pass it; omitting it while `load` still has requirements is a compile error
   (the server requirement would be un-discharged). This preserves the structural
   guarantee — `provide` can only be absent when there is nothing to discharge.
7. **No `Exclude`** is applied to `render`'s `R`. A server-only tag accidentally
   referenced in `render` therefore **remains** in the output `R` (rather than
   being silently erased), where `hydrate`'s `AssertNoServerOnly` can reject it.
   7a. `failure` is **conditionally required**: omitting it is a compile error when
   `ELoad ≠ never`, and allowed when `ELoad = never`. It does not alter the
   output channels (AC-4 is unchanged — `ELoad` already lives in the error
   channel whether or not `failure` is supplied).

### `ServerTag` / `AssertNoServerOnly` brand

8. `ServerTag(id)<Self, Shape>()` builds a `Context.Tag` whose identifier carries
   the `ServerOnly` brand. It is used exactly like `Context.Tag`; the brand rides
   along in the requirement channel `R` of any effect that uses the tag.
9. `AssertNoServerOnly<R>` passes `R` through unchanged when it contains no
   `ServerOnly`-branded dependency, and resolves to the `ServerOnlyLeak`
   compile-error sentinel when it does. (Applied to `hydrate`'s app-node `R` in the
   DOM client phase so a leaked server tag is a compile error.)

### Renderer contract (honoured by `@effect-ui/dom`; spec'd there)

10. **Server, hydratable pass:** run `Effect.provide(load(), provide)` to obtain
    `data: A` (blocking on it), `Schema.encode` + `JSON.stringify` it, emit
    `<script type="application/json">…</script>` inline at the region cursor
    (XSS-safe escaped), then render `render(data)` HTML in place.
11. **Server, plain SSR pass:** run `load` and render `render(data)` HTML, but emit
    **no** payload script (not hydratable).
12. **No-JS:** the server emits full `render(data)` HTML, complete without JS; the
    inline payload is consumed only by `hydrate`.
13. **Client (`hydrate`):** does **not** run `load`. Reads the inline payload at the
    cursor, `JSON.parse` → `Schema.decode` → `data`, **seeds a live `Resource<A>`**
    with `data` (AC-17), hydrates `render(resource)` against the adopted DOM, and
    steps over/removes the payload script so the cursor stays aligned. The seeded
    `value` emits `data` first, so the adopt-walk matches the server DOM. **Replays,
    never retries `load`**; the region stays live for subsequent `refetch`.
14. Region location during `hydrate` is **positional** (the payload sits at the
    cursor inside the region), matching the determinism the renderer already relies
    on for suspense / `List.each`.

### Typed-failure replay (v2)

15. **Server:** when `load` fails with a typed `ELoad` (i.e. `Cause.failureOption`
    is `Some`) on the **hydratable** pass, the error is `Schema.encode`d via
    `failure` and the encoded value is handed to the nearest enclosing failure
    `Boundary` (whose `match` handled the cause). That boundary emits, **before**
    its fallback HTML, a single
    `<script type="application/json" data-eui-boundary-failure>{"index":N,"error":<encoded>}</script>`,
    where `N` is the pre-order index of the failing `Boundary.server` among the
    `SERVER_BOUNDARY` descriptors statically reachable in the failure boundary's
    `children`. The `data-eui-boundary-failure` marker distinguishes it from a
    success payload. The original cause is preserved unchanged through `match`.
16. **Client (`hydrate`):** at a failure `Boundary` whose cursor is a
    `data-eui-boundary-failure` script, `hydrate` does **not** run `load`: it reads
    `{ index, error }`, locates the `index`-th statically-reachable
    `Boundary.server` in `children`, `Schema.decode`s `error` via **that
    boundary's** `failure` schema, rebuilds the typed `ELoad`, `Cause.fail`s it,
    and calls the failure boundary's `match` to obtain the **same** fallback,
    hydrating it against the adopted DOM and removing the script. **Replay, never
    retry.**
17. The failing `Boundary.server` must be **statically reachable** within the
    failure boundary's `children` (the index walk descends arrays, fragments,
    suspense boundaries, element children, and function components, but **not**
    into another `Boundary.server`'s data-dependent `render` output or a
    `List.each` projection). A failure under a non-reachable boundary is not
    indexed; it degrades to a recoverable hydration mismatch (as a missing
    payload would).

### Client refetch (phase 3)

17. **`Resource<A>` handed to `render`.** `render` receives a `Resource<A>`, not a
    bare `A`:
    - `value: Subscribable.Subscribable<A>` — the current data. On the **server**
      and on the **first client paint after hydrate** it is seeded with the SSR
      `data` (await-first, emits the seed immediately), so SSR HTML and the adopted
      DOM are byte-identical — no fallback flash. A successful refetch pushes the
      new value here, so the subtree patches in place via the renderer's existing
      reactive-child machinery.
    - `refetch: Effect.Effect<void>` — triggers an endpoint-backed reload (client
      only; a no-op on the server). It calls the router data endpoint, decodes the
      envelope via `schema`, and sets `value`.
    - `pending: Subscribable.Subscribable<boolean>` — `true` while a refetch is in
      flight (`false` on server / before any refetch).
    - `error: Subscribable.Subscribable<Option.Option<unknown>>` — `Some` with the
      last refetch error, else `None`. A failed refetch leaves the previous `value`
      intact (stale-on-error); it does **not** unmount the subtree or raise into an
      enclosing failure `Boundary`. (First-load failure is still the SSR/replay path
      via `failure`; refetch failures are surfaced through this channel for inline
      handling, never via suspense — refetch must not flash a fallback.)
18. **Registry.** Constructing a `Boundary.server` registers
    `{ id → { load, provide, schema, failure } }` in a module-level registry
    (`~/boundary/registry`) at **descriptor-build time**, independent of render, so
    any server process that has loaded the module graph can serve a refetch for that
    `id`. The registry is consulted only on the **server** (by the router data
    endpoint). On the **client** the prune plugin has stripped `load`/`provide`, so
    the client-side registry entry holds `undefined` for them — harmless, since the
    client never serves the endpoint. A duplicate `id` registration overwrites the
    previous entry (last registration wins; authors must keep `id`s unique).
19. **Endpoint replay (honoured by `@effect-ui/router`; spec'd there).** The router
    exposes `GET /_eui/data?id=<id>&params=<json>` returning a `schema`-encoded
    envelope. The handler looks up `id` in the registry, runs
    `Effect.provide(load(), provide)` **on the server**, `Schema.encode`s via the
    boundary's `schema`, and returns it. An unknown `id` ⇒ 404 (`BoundaryDataNotFound`).
    `load`/`provide`/`RServer` never leave the server; the client only ever holds a
    decoded `A`. See `packages/router/src/data-endpoint.specs.md`.

### Edge cases

- **Nesting:** a `Boundary.server` nested inside another emits its payload
  positionally within its own region; each `hydrate` reads its own payload.
- **Composition with `suspend` / `List.each`:** payloads are read positionally from
  the DOM cursor during the adopt-walk, interleaving correctly with suspense
  `<template>` markers and list markers.
- **No enclosing failure boundary:** a `load` failure with no enclosing failure
  `Boundary` fails the server render (no fallback to relocate the payload to) —
  unchanged from v1.
- **`match` returns `null` (re-propagation):** when the nearest failure boundary
  declines the cause, it re-fails **without** draining the failure payload, so the
  payload relocates to the next enclosing boundary that handles it (the index is
  recomputed against that boundary's `children`).
- **Defect (`Die`):** a `load` defect has no `Cause.failureOption`, so no failure
  payload is emitted; it propagates as in v1 (server fallback, client mismatch).
- **Multiple server boundaries under one failure boundary:** each is decoded via
  its own `failure` schema, located by the pre-order index — faithful, not
  best-effort.

---

## API shape

```ts
export const SERVER_BOUNDARY: unique symbol;

interface Resource<A> {
  readonly value: Subscribable.Subscribable<A>;
  readonly refetch: Effect.Effect<void>;
  readonly pending: Subscribable.Subscribable<boolean>;
  readonly error: Subscribable.Subscribable<Option.Option<unknown>>;
}

Boundary.server<A, ELoad, RServer, C extends Node<any, any>>(
  props: {
    id: string;
    load: () => Effect.Effect<A, ELoad, RServer>;
    provide?: Layer.Layer<RServer>;
    schema: Schema.Schema<A, any>;
    failure?: Schema.Schema<ELoad, any>;
  } & ([ELoad] extends [never] ? unknown : { failure: Schema.Schema<ELoad, any> })
    & ([RServer] extends [never] ? unknown : { provide: Layer.Layer<RServer> }),
  render: (resource: Resource<A>) => C,
): Node<Node.Error<C> | ELoad, Node.Context<C>>;

// Server-only dependency brand
class Database extends ServerTag("Database")<Database, DatabaseShape>() {}
type AssertNoServerOnly<R>; // R | ServerOnlyLeak
```

---

## Deferred / roadmap

**Shipped so far:** both **success serialization + replay** (v1) and
**typed-failure replay** (v2) — see the acceptance criteria above. (The
encode-in-catch design dissolved the documented `renderBoundarySSR` buffering
blocker: the failure payload is emitted by the enclosing failure boundary's catch
handler, which holds the cause and renders the fallback, never inside the
discarded children buffer.)

The phases below remain intentionally out of scope; each needs its own spec
discussion before any code. They are **not** versioned `vN` — v1/v2/v3 above are the
shipped phases; these are the remaining roadmap in rough priority order.

### 1. Prune plugin — bundle-size correctness (SHIPPED)

The `ServerTag` brand keeps the server tag out of universal **types**, but not
out of the **bundle**: the `provide` `Layer` (e.g. `DatabaseLive`) and the `load`
closure remain statically referenced by the universal node, so on a naive client
build they ship to the client. **Shipped** as `effectUiPrune()` in
`@effect-ui/vite` (see `packages/vite/src/prune.specs.md`): a `apply: "build"`
plugin that, on the non-SSR build, strips `load`/`provide` from each
`Boundary.server` call so the bundler tree-shakes the server-only code. This is
the second layer of the bundle-safety strategy — the `ServerTag` type brand is
the first. The optional-`provide` overload has since shipped (phase 3); `VITE_`
env gating remains a follow-on. (Until a project adopts the plugin, the unpruned
client bundle is runtime-safe-but-larger.)

### 2. Endpoint-backed client refetch (SHIPPED — phase 3)

Shipped: after a successful SSR hydrate the region is a live, reactive
`Resource<A>` and the client can `refetch` on demand. Refetch is **endpoint-backed**
— it re-runs the registered `load` on the **server** via the router's same-origin
`GET /_eui/data` endpoint and pushes the decoded result into the resource, so the
subtree patches in place. `load` never runs on the client (`AssertNoServerOnly`
holds). See AC-17 … AC-19 above and `packages/router/src/data-endpoint.specs.md`.

### 3. Progressive load & client-first mount

- **Streamed `load`** returning a `Stream` (stream-the-shell-then-fill). Today's
  workaround: nest `Boundary.server` inside `Boundary.suspend`, which already
  owns the fallback + streaming-patch machinery.
- **Client-first mount** (mounting a `Boundary.server` with no SSR payload, fetching
  on mount). Out of scope for phase 3 — refetch is only available after an SSR
  hydrate seeds the resource. Reach for `Boundary.suspend` for client-first data.

### 3. Ergonomic polish

- **Optional `provide` when `RServer = never` (SHIPPED).** `provide` is now
  omittable when `load` has no requirements — a conditional intersection on the
  signature (`[RServer] extends [never] ? unknown : { provide: … }`, mirroring
  `failure`) keeps it **required** whenever `RServer ≠ never`, and the constructor
  defaults an omitted `provide` to `Layer.empty`. The structural guarantee is
  preserved: `provide` can only be absent when there is nothing to discharge.
- `VITE_` env gating (the runtime complement to the prune plugin) remains a
  follow-on.

### Explicitly rejected (not deferred — will not do)

- **Bubble-to-entrypoint `provide`.** Incompatible with branding + `hydrate`: an
  external `Effect.provide(DatabaseLive)` would discharge `RServer` from `R`
  before `AssertNoServerOnly` could reject a leak. Required on-boundary `provide`
  _is_ the prevention.
- **Changes to `mount` / non-hydratable `renderToString` semantics.**
- **A `Hydration` service.** Considered and dropped before v1; payloads are read
  positionally from the DOM cursor during the adopt-walk with no service, so the
  remaining roadmap phases will not reintroduce one.
