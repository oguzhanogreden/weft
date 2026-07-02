---
title: "@weftui/dom"
order: 2
section: reference
description: Full API surface for @weftui/dom — the client renderer (mount, hydrate) and the server renderer (renderToString and streaming variants).
---

# @weftui/dom API Reference

The DOM renderer for Weft. It has two entry points — `@weftui/dom/client` for the
browser and `@weftui/dom/server` for Node — plus a package root that re-exports the
renderer error types. See the [Server-Side Rendering guide](../how-to/render-on-the-server.md)
for a narrative walkthrough.

## `@weftui/dom/client`

### `mount`

```ts
mount(node: Renderable, target: Element): Effect<MountHandle, RenderError, R>
```

Renders a Weft `node` into `target` for a fresh (non-SSR) page, building real DOM
and starting every reactive stream. Returns a `MountHandle` whose scope owns the
mounted tree; closing it tears the tree down. Use `mount` for purely client-rendered
apps; use `hydrate` when the markup already exists from SSR.

### `hydrate`

```ts
hydrate(node: Renderable, target: Element): Effect<MountHandle, HydrationMismatchError | RenderError, R>
```

Adopts server-rendered DOM **in place** inside `target` and resumes reactivity
without re-creating elements. The `node` must produce a tree structurally identical
to what the server rendered; a divergence fails with `HydrationMismatchError`. This
is the flash-free path: no second render, the existing nodes simply become live.

### `MountHandle`

The handle returned by `mount`/`hydrate`. Its lifetime is tied to the surrounding
scope (e.g. a `ManagedRuntime`); keep it alive for as long as the UI should stay
interactive.

## `@weftui/dom/server`

### `renderToString`

```ts
renderToString(node: Renderable): Effect<string, Error, AppRpcClientTag>
```

Renders `node` to a complete HTML string. Use for static, non-hydrated output.

### `renderToStringHydratable`

```ts
renderToStringHydratable(node: Renderable): Effect<string, Error, AppRpcClientTag>
```

Like `renderToString`, but embeds the hydration markers and inline boundary data
that `hydrate` needs on the client. Pair this with `hydrate`.

### `renderToStream` / `renderToStreamHydratable`

```ts
renderToStream(node: Renderable): Stream<string, Error, AppRpcClientTag>
renderToStreamHydratable(node: Renderable): Stream<string, Error, AppRpcClientTag>
```

Streaming variants that emit HTML chunks as the tree resolves, so the browser can
start painting before the whole page is ready. The `Hydratable` variant includes the
hydration markers. These back streaming SSR and suspense.

### `renderToHydratableShell`

```ts
renderToHydratableShell(node: Renderable): Effect<HydratableShell, Error, R>
```

Produces a `HydratableShell` — the document scaffold around the app — for servers
that assemble the response shell separately from the streamed body.

### Suspense failure handling

`SuspenseFailureHandlerTag` is the service tag for a `SuspenseFailureHandler`, which
maps a failed suspense boundary to a `SuspenseFailureSubstitute` (fallback markup)
during streaming SSR.

## Package root (`@weftui/dom`)

Re-exports the renderer error types:

- `HydrationMismatchError` — the client tree did not match the server markup.
- `UnsupportedNodeTypeError` — a node type the renderer cannot handle was encountered.
- `RenderError` — a general rendering failure.
- `StreamSubscriptionError` — a reactive stream backing the tree failed to subscribe.

## See also

- [Render on the Server](../how-to/render-on-the-server.md) — a narrative walkthrough of the server/client split
- [The Rendering Model](../explanation/rendering-model.md) — hydrate-in-place and why there is no virtual DOM
- [`@weftui/core` reference](./core.md) · [`@weftui/router` reference](./router.md)
