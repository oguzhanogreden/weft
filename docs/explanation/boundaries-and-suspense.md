---
title: Boundaries and Suspense
order: 4
section: explanation
description: How Weft models failure, async, and server data as boundary nodes in the same tree — failure-catch variants, Boundary.suspend, and Boundary.rpc, and how their E/R channels behave.
---

# Boundaries and Suspense

A **boundary** is a node that intercepts something flowing through the tree — an error, a pending async child, or a server-resolved value — and decides what the DOM shows in its place. Because a boundary is itself a `Node<E, R>` ([nodes are Effects](./rendering-model.md)), it composes exactly like any other element: you nest it, and its children's channels flow through it under a transformation the boundary defines.

The `Boundary` namespace has three kinds. This page is the conceptual map; the [core reference](../reference/core.md#boundary-namespace) has the full signatures.

## Failure boundaries

A component's `E` channel accumulates up the tree. A **failure boundary** is where you _discharge_ some of that `E`: it wraps children and, if one of them fails, renders a fallback instead of letting the failure propagate to the mount.

```typescript
import { Boundary, h } from "@weftui/core";

Boundary.catchAll({ fallback: (e) => h.div({ class: "error" }, `Failed: ${e.message}`) }, [
  RiskyWidget(),
]);
```

There are six failure-catch variants, mirroring Effect's own error operators so the mental model transfers directly:

| Variant                  | Catches                                    |
| ------------------------ | ------------------------------------------ |
| `catchAll`               | every failure in `E`                       |
| `catchAllCause`          | the full `Cause` (defects included)        |
| `catchTag` / `catchTags` | one / several tagged errors by `_tag`      |
| `catchSome` / `catchIf`  | a selected subset, by `Option` / predicate |

The channel algebra is the whole reason they exist: `catchTag("Foo", …)` removes `Foo` from the children's `E` and adds whatever the fallback needs — so the type of the boundary node reflects exactly which failures are still live and which were handled. An unhandled failure re-raises to the **nearest enclosing** boundary; if none catches it, the mount fails. Boundaries nest, so an inner `catchTag` can handle a specific case while an outer `catchAll` sweeps the rest.

## Suspense boundaries

`Boundary.suspend` wraps async children and shows a `fallback` until **all** of them have emitted their first value, then swaps atomically — either everything is visible or nothing is. This prevents partial flicker when sibling async regions resolve at different times.

```typescript
import { Boundary, h } from "@weftui/core";

Boundary.suspend({ fallback: h.div({ class: "spinner" }, "Loading…") }, [
  AsyncCard({ id: 1 }),
  AsyncCard({ id: 2 }),
]);
```

A suspense boundary is transparent to the type channels: its node is `Node<ChildrenE, ChildrenR>` — the children's `E`/`R` pass straight through, exactly as they would for a plain `h.*` parent. It changes _timing_ (when the children become visible), not _types_.

On the server, `renderToStreamHydratable` emits the fallback inline and appends patch scripts as children resolve; on the client, `hydrate` sees through the boundary and adopts the already-resolved DOM directly.

> **Note.** There is no `Suspense` export — the API is `Boundary.suspend(props, children)`. Reach for it for async that loads **on the client**; for data that must resolve on the **server** and hydrate without a second request, use `Boundary.rpc` (below).

## The rpc boundary

`Boundary.rpc` is the server-data boundary: it resolves one `Rpc` on the server, serializes the result into the HTML, replays it on the client during `hydrate` (no second request, no flash), and then keeps the region live for `refetch`. Conceptually it is the same idea as the other boundaries — a node that decides what renders in a subtree — but the thing it intercepts is a **round-trip to a server handler**, and instead of a children array it takes a `render` function that receives a reactive [`Resource`](../reference/core.md#resourcea).

```typescript
import { Boundary, h } from "@weftui/core";
import { Stream } from "effect";

Boundary.rpc(
  GetStock,
  () => ({ id: productId }),
  (resource) => h.span([Stream.map(resource.value.changes, (s) => String(s.units))]),
  { fallback: h.p("loading…") },
);
```

Unlike the failure and suspense boundaries, `Boundary.rpc` is not self-contained: it resolves through the ambient [`AppRpcClientTag`](../reference/core.md#apprpcclienttag) seam that `@weftui/router` provides on both sides. Its channel behavior is also distinct — the rpc's typed `error` schema joins the node's `E` (replayable through an enclosing failure boundary), while `render`'s `R` passes through untouched. The full model — the contract/handler split, the four lifecycles, typed-failure replay — is a **how-to**, not repeated here: [Load Data with RPC](../how-to/load-data-with-rpc.md).

## One tree, three interceptors

The unifying idea: failure, async pending state, and server data are not three separate subsystems bolted onto the renderer. They are three **boundary nodes** in the one tree, each intercepting a different thing flowing through it, each with channel behavior you can read off its type. That is why they nest freely — a `Boundary.catchTag` can wrap a `Boundary.rpc` to catch its typed failure, and a `Boundary.suspend` can wrap async siblings that themselves contain rpc boundaries.

## See also

- [The Rendering Model](./rendering-model.md) — why a boundary is just a node in a static tree
- [`Boundary` API reference](../reference/core.md#boundary-namespace) — every variant's signature and channel algebra
- [Load Data with RPC](../how-to/load-data-with-rpc.md) — the full `Boundary.rpc` walkthrough and its four lifecycles
- [Render on the Server](../how-to/render-on-the-server.md) — how suspense and rpc boundaries stream and hydrate
