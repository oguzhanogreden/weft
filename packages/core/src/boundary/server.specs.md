# Boundary.server — Core API Spec

## Overview

`Boundary.server` is a universal server/client render boundary: a region that is
byte-identical on server and client, where the **server** runs a `load` effect
(with server-only services supplied via `provide`), serializes the result inline,
and the **client** replays that serialized result during `hydrate` — never running
`load`. It gives a component a server-only data dependency while staying co-located
in the universal tree.

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
- **Out of scope:** a `load` **defect** (a `Die`, not an expected `ELoad`) is not
  replayed — it has no `Cause.failureOption`, so no failure payload is emitted and
  it propagates as before (server renders the enclosing fallback; the client
  hydrate produces a recoverable mismatch). Prune plugin, progressive/streamed
  `load`, client refetch, and an ergonomic optional-`provide` overload remain
  deferred (see below).

---

## Acceptance Criteria

### Descriptor

1. `Boundary.server(props, render)` returns a plain object `{ type: SERVER_BOUNDARY, props }`
   carried on the node via `elementNode` — readable through `getElementDescriptor`
   **without running the node** (and therefore without running `load`).
2. `props` contains:
   - `load: () => Effect.Effect<A, ELoad, RServer>` — a **thunk** (defers
     construction so `load` is built/run only on the server)
   - `provide: Layer.Layer<RServer>` — discharges `load`'s server-only requirements
   - `schema: Schema.Schema<A, any>` — the wire contract for `A`
   - `failure?: Schema.Schema<ELoad, any>` — the wire contract for a typed `load`
     failure; **required when `ELoad ≠ never`**, omittable when `load` cannot fail
   - `render: (data: A) => C` — builds the subtree from the loaded data
3. The `SERVER_BOUNDARY` symbol is exported from `@effect-ui/core` for renderers.

### Signature / channel algebra

4. Output type is `Node<Node.Error<C> | ELoad, Node.Context<C>>`:
   - The error channel is `render`'s error union plus `ELoad`.
   - The requirement channel is exactly `render`'s `R` — **untouched**.
5. `RServer` is **absent** from the output requirement channel: `provide` consumes
   it at construction (it feeds only `load`, never `render`), so no un-discharged
   server requirement can escape into `R`.
6. `provide` is **required** (single signature). Passing `Layer.empty` is the
   intended form when `RServer` is `never`. Omitting `provide` is a compile error.
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
    cursor, `JSON.parse` → `Schema.decode` → `data`, hydrates `render(data)` against
    the adopted DOM, and steps over/removes the payload script so the cursor stays
    aligned. **Replays, never retries.**
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

Boundary.server<A, ELoad, RServer, C extends Node<any, any>>(
  props: {
    load: () => Effect.Effect<A, ELoad, RServer>;
    provide: Layer.Layer<RServer>;
    schema: Schema.Schema<A, any>;
    failure?: Schema.Schema<ELoad, any>;
  } & ([ELoad] extends [never] ? unknown : { failure: Schema.Schema<ELoad, any> }),
  render: (data: A) => C,
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
discussion before any code. They are **not** versioned `vN` — v1/v2 above are the
shipped phases; these are the remaining roadmap in rough priority order. **The
next session starts with phase 2, progressive load & client refetch.**

### 1. Prune plugin — bundle-size correctness (SHIPPED)

The `ServerTag` brand keeps the server tag out of universal **types**, but not
out of the **bundle**: the `provide` `Layer` (e.g. `DatabaseLive`) and the `load`
closure remain statically referenced by the universal node, so on a naive client
build they ship to the client. **Shipped** as `effectUiPrune()` in
`@effect-ui/vite` (see `packages/vite/src/prune.specs.md`): a `apply: "build"`
plugin that, on the non-SSR build, strips `load`/`provide` from each
`Boundary.server` call so the bundler tree-shakes the server-only code. This is
the second layer of the bundle-safety strategy — the `ServerTag` type brand is
the first. `VITE_` env gating and the optional-`provide` overload remain
follow-ons. (Until a project adopts the plugin, the unpruned client bundle is
runtime-safe-but-larger.)

### 2. Progressive load & client refetch

- **Streamed `load`** returning a `Stream` (stream-the-shell-then-fill). Today's
  workaround: nest `Boundary.server` inside `Boundary.suspend`, which already
  owns the fallback + streaming-patch machinery.
- **Client-side mutation/refetch** of server data (re-running `load` on the
  client). v1 is strictly replay-only; reach for ordinary client services to
  refresh.

### 3. Ergonomic polish

- An optional-when-`never` `provide` overload so `provide` can be omitted (rather
  than passing `Layer.empty`) when `RServer = never`. v1 ships a single required
  signature deliberately — required `provide` is the structural guarantee no
  un-discharged server requirement escapes into `R`.

### Explicitly rejected (not deferred — will not do)

- **Bubble-to-entrypoint `provide`.** Incompatible with branding + `hydrate`: an
  external `Effect.provide(DatabaseLive)` would discharge `RServer` from `R`
  before `AssertNoServerOnly` could reject a leak. Required on-boundary `provide`
  _is_ the prevention.
- **Changes to `mount` / non-hydratable `renderToString` semantics.**
- **A `Hydration` service.** Considered and dropped before v1; payloads are read
  positionally from the DOM cursor during the adopt-walk with no service, so the
  remaining roadmap phases will not reintroduce one.
