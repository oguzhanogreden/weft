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

### v1 scope

- **Success serialization + replay only.** Typed-failure replay (encoding a
  `load` failure for the client to re-raise) is a deferred phase. In v1 a `load`
  failure is handled **server-side only**: it propagates to the nearest enclosing
  failure `Boundary` (so the no-JS page shows that fallback). Hydrating a boundary
  whose server `load` failed therefore produces a recoverable hydration mismatch
  (logged) — so v1 examples/tests use a non-failing (or boundary-wrapped,
  success-on-client) `load`.

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

### Edge cases

- **Nesting:** a `Boundary.server` nested inside another emits its payload
  positionally within its own region; each `hydrate` reads its own payload.
- **Composition with `suspend` / `List.each`:** payloads are read positionally from
  the DOM cursor during the adopt-walk, interleaving correctly with suspense
  `<template>` markers and list markers.

---

## API shape

```ts
export const SERVER_BOUNDARY: unique symbol;

Boundary.server<A, ELoad, RServer, C extends Node<any, any>>(
  props: {
    load: () => Effect.Effect<A, ELoad, RServer>;
    provide: Layer.Layer<RServer>;
    schema: Schema.Schema<A, any>;
  },
  render: (data: A) => C,
): Node<Node.Error<C> | ELoad, Node.Context<C>>;

// Server-only dependency brand
class Database extends ServerTag("Database")<Database, DatabaseShape>() {}
type AssertNoServerOnly<R>; // R | ServerOnlyLeak
```
