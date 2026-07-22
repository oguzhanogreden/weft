---
title: Boundaries and Suspense
order: 4
section: explanation
description: How Weft models failure, async, and server data as boundary nodes in the same tree. Covers failure-catch variants, Boundary.suspend, and Boundary.rpc, and how their E/R channels behave.
---

# Boundaries and Suspense

A **boundary** is a node that intercepts something flowing through the tree: an error, a pending async child, or a server-resolved value. It decides what the DOM shows in its place.

A boundary is itself a `Node<E, R>` ([nodes are Effects](./rendering-model.md)), so it composes exactly like any other element. You nest it, and its children's channels flow through it under a transformation the boundary defines.

The `Boundary` namespace has three kinds. This page is the conceptual map; the [core reference](../reference/core.md#boundary-namespace) has the full signatures.

## Failure boundaries

A component's `E` channel accumulates up the tree. A **failure boundary** is where you _discharge_ some of that `E`. It wraps children and, if one of them fails, renders a fallback instead of letting the failure propagate to the mount.

```typescript
import { Boundary, h } from "@weftui/core";

Boundary.catch({ fallback: (e) => h.div({ class: "error" }, `Failed: ${e.message}`) }, [
  RiskyWidget(),
]);
```

There are six failure-catch variants, mirroring Effect's own error operators so the mental model transfers directly:

| Variant                   | Catches                                    |
| ------------------------- | ------------------------------------------ |
| `catch`                   | every failure in `E`                       |
| `catchCause`              | the full `Cause` (defects included)        |
| `catchTag` / `catchTags`  | one / several tagged errors by `_tag`      |
| `catchFilter` / `catchIf` | a selected subset, by `Filter` / predicate |

The channel algebra is the whole reason they exist. `catchTag("Foo", …)` removes `Foo` from the children's `E` and adds whatever the fallback needs. The type of the boundary node therefore reflects exactly which failures are still live and which were handled.

An unhandled failure re-raises to the **nearest enclosing** boundary; if none catches it at **mount time**, mounting fails. Boundaries nest, so an inner `catchTag` can handle a specific case while an outer `catch` sweeps the rest.

### Post-mount failures with no enclosing boundary

The routing above describes what happens while a node is being built. Once mounted, a reactive region keeps running for the lifetime of its scope: an attribute, a child, a list stream, or a hydrated equivalent. It can still fail later, e.g. a `Boundary.rpc` resource's refetch stream raising after a client-side navigation.

If a boundary encloses the region, the failure routes to it exactly as above and its fallback swaps in. If none does, there is nothing to swap to. Weft does not synthesize one: the region's DOM keeps its last rendered content, and a watcher fiber (forked alongside the subscription itself) observes the exit instead.

An exit whose cause is not interruption-only publishes an `UnhandledError` (`cause`, `region`, `root`) to the app's unhandled-error hub, exposed as `WeftApp.errors(app)`. `region` names the failing spot: `attribute:class`, `child:stream-3`, or `boundary:outermost` for a failure that escapes even the outermost boundary. Subscribe to observe every occurrence yourself:

```typescript
import { WeftApp } from "@weftui/dom/client";
import { Effect, Stream } from "effect";

Effect.runFork(
  Stream.runForEach(WeftApp.errors(app), (error) =>
    Effect.log(`unhandled in ${error.region}`, error.cause),
  ),
);
```

With zero subscribers, each unhandled error instead runs a default `Effect.logError(cause)` annotated with `weft.region`, exactly once per occurrence, in dev and prod alike. Subscribing suppresses that fallback for as long as at least one subscriber stays attached.

This is deliberate: rather than leave an unobserved fiber exit to the runtime, Weft always surfaces it, either to your subscriber or to the log. Interruption (ordinary unmount teardown) is never published or logged; only genuine failures are.

A stream that can fail with no enclosing boundary is a stream whose failures you've chosen not to route into the UI. `WeftApp.errors` (and the log fallback) is what tells you that decision has consequences at runtime. Full contract: [`WeftApp.errors` / `UnhandledError`](../reference/dom.md#weftapperrors).

## Suspense boundaries

`Boundary.suspend` wraps async children and shows a `fallback` until **all** of them have emitted their first value. Then it swaps atomically: either everything is visible or nothing is. This prevents partial flicker when sibling async regions resolve at different times.

```typescript
import { Boundary, h } from "@weftui/core";

Boundary.suspend({ fallback: h.div({ class: "spinner" }, "Loading…") }, [
  AsyncCard({ id: 1 }),
  AsyncCard({ id: 2 }),
]);
```

A suspense boundary is transparent to the type channels: its node is `Node<ChildrenE, ChildrenR>`. The children's `E`/`R` pass straight through, exactly as they would for a plain `h.*` parent. It changes _timing_ (when the children become visible), not _types_.

On the server, `renderToStreamHydratable` emits the fallback inline and appends patch scripts as children resolve. On the client, `hydrate` sees through the boundary and adopts the already-resolved DOM directly.

> **Note.** There is no `Suspense` export; the API is `Boundary.suspend(props, children)`. Reach for it for async that loads **on the client**. For data that must resolve on the **server** and hydrate without a second request, use `Boundary.rpc` (below).

## The rpc boundary

`Boundary.rpc` is the server-data boundary. It:

- resolves one `Rpc` on the server
- serializes the result into the HTML
- replays it on the client during `hydrate` (no second request, no flash)
- keeps the region live for `refetch`

Conceptually it is the same idea as the other boundaries: a node that decides what renders in a subtree. But the thing it intercepts is a **round-trip to a server handler**. Instead of a children array, it takes a `render` function that receives a reactive [`Resource`](../reference/core.md#resourcea).

```typescript
import { Boundary, h, Subscribable } from "@weftui/core";
import { Stream } from "effect";

Boundary.rpc(
  GetStock,
  () => ({ id: productId }),
  (resource) => h.span([Stream.map(Subscribable.changes(resource.value), (s) => String(s.units))]),
  { fallback: h.p("loading…") },
);
```

Unlike the failure and suspense boundaries, `Boundary.rpc` is not self-contained. It resolves through the ambient [`AppRpcClientTag`](../reference/core.md#apprpcclienttag) seam that `@weftui/router` provides on both sides.

Its channel behavior is also distinct. The rpc's typed `error` schema joins the node's `E` (replayable through an enclosing failure boundary), while `render`'s `R` passes through untouched. The full model (the contract/handler split, the four lifecycles, typed-failure replay) is a **how-to**, not repeated here: [Load Data with RPC](../how-to/load-data-with-rpc.md).

## One tree, three interceptors

The unifying idea: failure, async pending state, and server data are not three separate subsystems bolted onto the renderer. They are three **boundary nodes** in the one tree, each intercepting a different thing flowing through it. Each has channel behavior you can read off its type.

That is why they nest freely. A `Boundary.catchTag` can wrap a `Boundary.rpc` to catch its typed failure, and a `Boundary.suspend` can wrap async siblings that themselves contain rpc boundaries:

```typescript
import { Boundary, h, Subscribable } from "@weftui/core";
import { Stream } from "effect";

Boundary.catchTag({ tag: "StockRpcError", fallback: () => h.p("Couldn't load stock.") }, [
  Boundary.rpc(
    GetStock,
    () => ({ id: productId }),
    (resource) =>
      h.span([Stream.map(Subscribable.changes(resource.value), (s) => String(s.units))]),
  ),
]);
```

Each layer only sees the channel its own kind produces: `catchTag` narrows `E`, `Boundary.rpc` widens it by the rpc's error schema. Neither cares how the other renders.

## See also

- [The Rendering Model](./rendering-model.md): why a boundary is just a node in a static tree
- [`Boundary` API reference](../reference/core.md#boundary-namespace): every variant's signature and channel algebra
- [`WeftApp.errors` / `UnhandledError`](../reference/dom.md#weftapperrors): the unhandled-error hub for post-mount failures with no enclosing boundary
- [Load Data with RPC](../how-to/load-data-with-rpc.md): the full `Boundary.rpc` walkthrough and its four lifecycles
- [Render on the Server](../how-to/render-on-the-server.md): how suspense and rpc boundaries stream and hydrate
