---
title: Server-Side Rendering
order: 3
section: guides
description: renderToString / renderToStringHydratable / streaming variants, hydrate, and the server/client split.
---

# Server-Side Rendering

Weft renders on the server and **hydrates** on the client: the server produces HTML (plus inline data), and the browser adopts that existing DOM in place rather than re-creating it. [`Boundary.rpc`](../api/core.md#boundaryrpc) extends this to **rpc-backed server data** — resolve an rpc on the server, serialize its result into the HTML, replay it on the client without a second request, and then keep the region live for refetch.

## The two halves

- **Server** — `@weftui/dom/server` renders an app node to an HTML string (or stream). The _hydratable_ variants additionally emit the inline data each reactive region and `Boundary.rpc` needs to resume on the client.
- **Client** — `@weftui/dom/client`'s `hydrate` walks the server DOM, adopts it, wires up reactivity and event handlers, and resumes from the inline data. It does **not** re-render from scratch.

```typescript
// server entry
import { renderToStringHydratable } from "@weftui/dom/server";
import { Effect } from "effect";
import { App } from "./app";

export const render = (): Promise<string> => Effect.runPromise(renderToStringHydratable(App()));
```

```typescript
// client entry
import { hydrate } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root")!;
void Effect.runPromise(hydrate(App(), root));
```

The same side-effect-free `App` is imported by both entries — splice the server HTML into your template's outlet, ship it, and let the client entry hydrate it.

`@weftui/dom/server` exports four renderers:

|                                        | String                     | Stream                     |
| -------------------------------------- | -------------------------- | -------------------------- |
| **Plain** (no JS / no hydration)       | `renderToString`           | `renderToStream`           |
| **Hydratable** (emits inline payloads) | `renderToStringHydratable` | `renderToStreamHydratable` |

Use a hydratable renderer whenever the client will call `hydrate`. The plain renderers produce complete, JS-free HTML with no payload scripts.

## Loading server data with `Boundary.rpc`

`Boundary.rpc` resolves an rpc on the server, serializes its result into the page, and replays it on the client — then keeps the region live so the client can `refetch`. The data source is one `Rpc` from the app's merged `RpcGroup`: its **contract** (pure Schema) is shared with the client, while its **handler** lives in a server-only Layer the client never imports. The client/server split is structural — tree-shaking keeps the handler out of the browser bundle.

```typescript
// data/inventory.ts — the contract (shareable) + the handler (server-only)
import { Rpc, RpcGroup } from "@effect/rpc";
import { Context, Effect, Layer, Schema } from "effect";

const Stock = Schema.Struct({ units: Schema.Number });
const StockKey = Schema.Struct({ id: Schema.Number });

// The rpc: its `_tag` ("GetStock") is the stable boundary id, its payload schema the typed input.
export const GetStock = Rpc.make("GetStock", { payload: StockKey, success: Stock });
export const StockRpcs = RpcGroup.make(GetStock); // merged group — shared by client + server wiring

// A server-only service the handler reads (see ServerTag below).
class Inventory extends Context.Tag("Inventory")<
  Inventory,
  { readonly stockFor: (id: number) => Effect.Effect<typeof Stock.Type> }
>() {}

// The handler Layer: server-only, never imported by the client bundle.
export const StockLive = StockRpcs.toLayer({
  GetStock: (payload) => Effect.flatMap(Inventory, (inv) => inv.stockFor(payload.id)),
}).pipe(Layer.provide(InventoryLive));
```

The boundary itself is a **thin consumer** — it passes the rpc, a payload thunk, and a `render` that receives a reactive [`Resource`](../api/core.md#resourcea):

```typescript
import { Boundary, h } from "@weftui/core";
import { Stream } from "effect";
import { GetStock } from "./data/inventory";

const StockPanel = (productId: number) =>
  Boundary.rpc(
    GetStock,
    () => ({ id: productId }), // a fresh typed payload per call (SSR / refetch / mount)
    (resource) =>
      h.p([
        "in stock: ",
        h.span([Stream.map(resource.value.changes, (stock) => String(stock.units))]),
        h.button({ type: "button", onclick: () => resource.refetch }, "Refresh"),
      ]),
    { fallback: h.p("loading stock…") }, // shown only on a client-first SPA mount
  );
```

What happens at each stage:

- **Server:** resolves the rpc in-process (over the handler Layer), `successSchema`-encodes the result, emits it inline as `<script type="application/json">` at the cursor, then renders `render(seededResource)` to HTML in place.
- **Hydrate:** `hydrate` reads that inline payload positionally, `successSchema`-decodes it, seeds the `Resource`, and adopts the DOM. It **never re-calls the rpc** — the data is _replayed_. The region then stays live for refetch.
- **Refetch:** `resource.refetch` calls the rpc again over the network (`POST /_eui/rpc`), re-running the handler on the server, and patches the subtree in place — **stale-on-error** (a failed refetch leaves the previous value intact).
- **Client-first mount:** SPA-navigating into a boundary with no SSR payload renders `fallback`, forks the rpc call, and swaps in `render(resource)` once it resolves.

The arguments:

- **`rpc`** — an `Rpc` from the merged group. Its `_tag` is the stable boundary identity (replacing a hand-rolled `id`) and its `payload`/`success`/`error` schemas are the wire contract.
- **`payload`** — a **thunk** producing a fresh, typed `Rpc.Payload` per call. The payload is a real input (here, the product id), so one rpc serves per-entity data across many boundaries.
- **`render`** — builds the subtree from a reactive [`Resource`](../api/core.md#resourcea) (the **second positional argument**, not a children array). Its requirement channel `R` passes through to the output untouched.
- **`options.fallback`** — shown only during a client-first mount; the SSR/hydrate path renders the seeded payload with no fallback flash.

### Wiring the router

The boundary resolves through the ambient [`AppRpcClientTag`](../api/core.md#apprpcclienttag) seam, which `@weftui/router` provides on both sides — pass the merged group (and, on the server, the handler Layer):

```typescript
// server entry — RouterServer provides an in-process client over the handlers
RouterServer.render(App, { document, rpc: { group: StockRpcs, handlers: StockLive }, url });

// client entry — RouterLive provides a network client (POST /_eui/rpc)
ManagedRuntime.make(RouterLive(App, { rpc: { group: StockRpcs } }));
```

`RouterServer` mounts the handler Layer at `POST /_eui/rpc` (so a client refetch re-runs it on the server) **and** exposes an in-process client over the same handlers for SSR resolution. See the [router API](../api/router.md#routerserver). In a router-less mount there is no `AppRpcClientTag`, so a `Boundary.rpc` resolves to a descriptive "needs router/rpc" error.

### Brand server-only services with `ServerTag`

The handler reads server-only services (`Inventory` above). Declare those with [`ServerTag`](../api/core.md#servertag) rather than `Context.Tag`: the brand rides the requirement channel, and because `render` only ever touches the decoded result (not the service), the boundary's output `R` stays free of it. If a branded tag ever leaks into `render` and survives into `hydrate`, `AssertNoServerOnly` turns it into a compile error at the `hydrate` call site — there is no `provide` on the boundary to silently absorb it.

### Typed-failure replay

If the rpc declares an `error` schema, a resolved rpc **error** on the SSR pass is `errorSchema`-encoded into an inline failure payload and the nearest enclosing failure `Boundary` renders its fallback. On the client `hydrate` decodes that payload and **re-raises the same error into the same boundary**, reproducing the identical fallback DOM — flash-free and without re-resolving the rpc (replay, never retry). A transport **defect**, or an rpc with no `error` schema, is not replayed; it propagates.

## When to use

- **`Boundary.rpc`** — data that must be resolved on the server (behind a server-only service, credential, or private network) and rendered into the initial HTML, then **refreshable** on the client (refetch / client-first SPA mount) over the same rpc.
- **`Boundary.suspend`** — async data that loads on the client (or streams the shell then fills); see the [Boundary API](../api/core.md#boundarysuspend).

## See also

- [rpc data boundaries guide](./rpc-data-boundaries.md) — the full `Boundary.rpc` walkthrough: contract/handler split, router wiring, the four lifecycles, and typed-failure replay
- [Routing](./routing.md) — `@weftui/router` builds on this SSR + hydration model for full-page nested routing
- [`Boundary.rpc` API reference](../api/core.md#boundaryrpc)
- [`ServerTag` API reference](../api/core.md#servertag)
- [examples/router-ssr](../../examples/router-ssr) — a runnable shop with an SSR-replayed, refetchable live-stock `Boundary.rpc`
- [examples/ssr-hydration](../../examples/ssr-hydration) — SSR + hydration without server data loading
