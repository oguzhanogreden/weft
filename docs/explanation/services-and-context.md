---
title: Services and Context
order: 5
section: explanation
description: How Effect services reach components — the requirement channel, discharging R at the mount, the router's render-time context seam, and ServerTag server-only brands.
---

# Services and Context

Weft has no separate dependency-injection system. It uses Effect's — a component that needs a service reads it with `yield* Service`, and because [a node is an Effect](./rendering-model.md), that requirement rides the node's `R` channel up the tree to a single point where you provide it. This page explains how a service travels from where you provide it to where a component reads it, and the two seams that make that work across the server/client boundary.

## R accumulates, then discharges once

When a component does `yield* ThemeService`, `ThemeService` enters that node's requirement channel. It accumulates through every parent — a boundary, a layout, the app node — until the whole tree's `R` is the union of everything any component needs. You satisfy it in **one** place, at the edge:

```typescript
import { Effect } from "effect";
import { mount } from "@weftui/dom/client";

const handle = pipe(
  mount(App(), document.getElementById("root")!),
  Effect.provide(ThemeServiceLive),
);
```

Provide too little and it is a compile error at the mount call — the type of `App()` names exactly which service is missing. This is the same discipline as any Effect program: `R` is a promise the type checker holds you to, discharged at the program's boundary, not sprinkled through the tree.

Services flow **down** from that provide point to every reader, including across reactive boundaries: a stream woven into a prop carries its own `R`, and a handler that reads a service resolves it from the same context. There is no prop-drilling and no context-provider component — the requirement channel _is_ the wiring.

## Layer lifetime at the mount

The `ThemeServiceLive` example above works because `mount`'s effect and the service's lifetime coincide by accident: `ThemeServiceLive` is a plain value layer with nothing to release, so it makes no difference whether it is "alive" for one tick or the whole session. That accident stops holding the moment the layer is **scoped** — built with `Layer.scoped`, backed by an `acquireRelease` — because `mount`'s effect resolves right after the tree's **initial render**, not when the app stops running. Streams, event handlers, and forked work all keep running on the mount's runtime long after that Effect has settled.

`Effect.provide(scopedLayer)` is `acquireUseRelease` sugar: acquire, run the wrapped effect, then release **when that effect completes**. Wrap it directly around `mount`, and the release runs at mount-resolve — while the mounted tree is still reading from the now-disposed service:

```typescript
// ❌ the layer's finalizers run the instant runPromise settles, while the
// mounted tree keeps running — every subscription now reads a disposed service
Effect.runPromise(mount(App(), root).pipe(Effect.provide(SomeScopedLayer)));
```

This is exactly what happened with the atom registry layer (`AtomRegistry.layer`, from `effect/unstable/reactivity`) in the [`effect-atom` example](../../examples/effect-atom) (issue #122): every atom-driven region rendered empty, with no error, because the registry the streams read from had already been disposed.

The fix is to give the scoped layer a lifetime that matches the app, not the initial render: provide it **outside** a scoped region that stays open for as long as the app should run, and mount inside that region with `mountScoped` (which ties `unmount` to the region's scope instead of to the resolution of the mount effect). An `Effect.never` (or `Deferred.await` on a shutdown signal) keeps the region — and therefore the layer — alive until something explicitly closes it. See [Provide Services](../how-to/provide-services.md) for the recipe, including the `ManagedRuntime` alternative when a scoped region isn't a good fit.

## The router's render-time context seam

A plain `mount`/`hydrate` discharges `R` at the call site. But under `@weftui/router`, the tree does not render in the context of the effect that called `render` — each request dispatches through platform's HTTP layer in its own managed context, and the reactive outlet drains in the top render context, not in any intermediate node's. Providing a service _ambiently_ around the render would be lost before it reached a route component.

So the router exposes an explicit **`context` seam** — a `Layer` threaded to the document shell and every route, layout, and leaf:

```typescript
class Greeting extends Context.Service<Greeting, { text: string }>()("Greeting") {}

// server entry
RouterServer.render(App, { document, url, context: Layer.succeed(Greeting, { text: "hi" }) });

// client entry — same seam, so the hydrated tree reads the same services
RouterLive(App, { context: DocsLive });
```

The seam is **symmetric** (same shape on both sides) and **type-tracked**: the def's aggregate residual `R` is discharged here, so a missing provide is a compile error rather than a runtime 500. The residual is `AppServices<R>` — the def's `R` minus what the router itself threads (`Router`, `Router.Outlet`, `AppRpcClientTag`). An app with no app-services needs no `context`; a loosely-typed `RouterDef<any, any>` may omit it. This is how the website provides its `Docs` service to every page — see [Add Routing](../how-to/add-routing.md).

## Server-only services: `ServerTag`

Some services must _never_ run in the browser — a database handle, a private credential, an rpc handler's backing store. Declare those with [`ServerTag`](../reference/core.md#servertag) instead of `Context.Service`. It behaves exactly like `Context.Service`, but its identifier carries a **server-only brand**.

The brand's job is to turn a leak into a **compile error at the `hydrate` call site**. A `Boundary.rpc` handler legitimately reads server-only services on the server, but they must not survive into client code: since `render` only ever touches the _decoded result_ (never the service), a correctly-written boundary keeps its output `R` free of the brand. If a branded tag ever leaks into `render` and reaches the client requirement channel, `hydrate`'s `AssertNoServerOnly` resolves `R` to a compile-error sentinel — you learn at build time, not from a runtime defect.

```typescript
import { ServerTag } from "@weftui/core";

// Only ever provided on the server; a leak into client code fails to compile.
class Db extends ServerTag("Db")<Db, { query: (sql: string) => Effect.Effect<Row[]> }>() {}
```

## The whole picture

- A component reads a service with `yield* Service`; the requirement enters `R`.
- `R` accumulates through the tree and is discharged **once** — at `mount`/`hydrate`, or through the router's `context` seam.
- The same services flow to the same components on the server and the client, because it is the same tree.
- `ServerTag` brands the services that must stay server-side, enforced at the `hydrate` boundary.

## See also

- [The Rendering Model](./rendering-model.md) — why services flow through the tree at all
- [The Combinator API](./combinator-api.md) — how `R` accumulates from children and reactive props
- [Provide Services](../how-to/provide-services.md) — recipes for value layers, scoped layers with `mountScoped`, and `ManagedRuntime`
- [Add Routing](../how-to/add-routing.md) — providing app services through the router `context` seam
- [Load Data with RPC](../how-to/load-data-with-rpc.md) — where `ServerTag` and the rpc handler Layer meet
- [`ServerTag` API reference](../reference/core.md#servertag)
