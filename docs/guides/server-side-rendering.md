# Server-Side Rendering

effect-ui renders on the server and **hydrates** on the client: the server produces HTML (plus inline data), and the browser adopts that existing DOM in place rather than re-creating it. `Boundary.server` extends this to **server-side data loading** — load data on the server, serialize it into the HTML, and replay it on the client without re-running the load.

## The two halves

- **Server** — `@effect-ui/dom/server` renders an app node to an HTML string (or stream). The _hydratable_ variants additionally emit the inline data each reactive region and `Boundary.server` needs to resume on the client.
- **Client** — `@effect-ui/dom/client`'s `hydrate` walks the server DOM, adopts it, wires up reactivity and event handlers, and resumes from the inline data. It does **not** re-render from scratch.

```typescript
// server entry
import { renderToStringHydratable } from "@effect-ui/dom/server";
import { Effect } from "effect";
import { App } from "./app";

export const render = (): Promise<string> => Effect.runPromise(renderToStringHydratable(App()));
```

```typescript
// client entry
import { hydrate } from "@effect-ui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root")!;
void Effect.runPromise(hydrate(App(), root));
```

The same side-effect-free `App` is imported by both entries — splice the server HTML into your template's outlet, ship it, and let the client entry hydrate it.

`@effect-ui/dom/server` exports four renderers:

|                                        | String                     | Stream                     |
| -------------------------------------- | -------------------------- | -------------------------- |
| **Plain** (no JS / no hydration)       | `renderToString`           | `renderToStream`           |
| **Hydratable** (emits inline payloads) | `renderToStringHydratable` | `renderToStreamHydratable` |

Use a hydratable renderer whenever the client will call `hydrate`. The plain renderers produce complete, JS-free HTML with no payload scripts.

## Loading server data with `Boundary.server`

`Boundary.server` runs an Effect on the server, serializes its result into the page, and replays it on the client:

```typescript
import { Boundary, ServerTag, h } from "@effect-ui/core";
import { Effect, Layer, Schema } from "effect";

interface Product {
  readonly name: string;
  readonly price: number;
}

// A server-only service (see ServerTag below).
class Database extends ServerTag("Database")<
  Database,
  { readonly getProduct: () => Effect.Effect<Product> }
>() {}

const DatabaseLive = Layer.succeed(Database, {
  getProduct: () => Effect.succeed({ name: "Effect Mug", price: 18 }),
});

const ProductSchema = Schema.Struct({ name: Schema.String, price: Schema.Number });

const ProductPage = () =>
  Boundary.server(
    {
      load: () => Effect.flatMap(Database, (db) => db.getProduct()),
      provide: DatabaseLive,
      schema: ProductSchema,
    },
    (product) => h.div({ class: "product" }, [h.h1(product.name), h.p(`$${product.price}`)]),
  );
```

What happens at each stage:

- **Server:** runs `Effect.provide(load(), provide)` to obtain `data`, `schema`-encodes it, emits it inline as `<script type="application/json">` at the cursor, then renders `render(data)` to HTML in place.
- **Client:** `hydrate` reads that inline payload positionally, `schema`-decodes it, and hydrates `render(data)` against the adopted DOM. It **never runs `load`** and never touches `Database` — the data is _replayed_, not refetched.

The props:

- **`load`** — a thunk producing the server Effect. It is deferred so it is constructed and run **only on the server**.
- **`provide`** — a `Layer` discharging `load`'s server-only requirements. Required when `load` has requirements; see [optional `provide`](#optional-provide).
- **`schema`** — the wire contract for the loaded data: `Schema.encode`d on the server, `Schema.decode`d on the client.
- **`render`** — builds the subtree from the loaded data (the **second argument**, not a children array). Its requirement channel `R` passes through to the output untouched.

### Brand server-only services with `ServerTag`

The bundle/runtime safety hinges on server-only services being declared with [`ServerTag`](../api/core.md#servertag) rather than `Context.Tag`. The brand rides in the requirement channel; `provide` discharges it on the server, so `ProductPage()`'s `R` is `never` and the client `hydrate(ProductPage(), root)` type-checks **without** `Database` in scope. If a branded tag ever leaks into `render` and survives into `hydrate`, `AssertNoServerOnly` turns it into a compile error at the `hydrate` call site.

### Typed-failure replay

If `load` can fail with a typed error (`ELoad ≠ never`), `failure` becomes **required** — it is the wire contract for that error:

```typescript
class ProductLoadError extends Schema.TaggedError<ProductLoadError>()("ProductLoadError", {
  reason: Schema.String,
}) {}

Boundary.catchAll({ fallback: (e: ProductLoadError) => h.div({ class: "error" }, e.reason) }, [
  Boundary.server(
    {
      load: () => Effect.fail(new ProductLoadError({ reason: "out of stock" })),
      provide: Layer.empty,
      schema: ProductSchema,
      failure: ProductLoadError,
    },
    (product) => h.div(product.name),
  ),
]);
```

On the server the typed error is encoded into an inline failure payload and the enclosing failure `Boundary` renders its fallback. On the client `hydrate` decodes that payload and **re-raises the same error into the same boundary**, reproducing the identical fallback DOM — flash-free and **without re-running `load`** (replay, never retry). A defect (not an expected `ELoad`) is not replayed; it propagates as a normal render failure.

### Optional `provide`

`provide` is **required only when `load` has requirements** (`RServer ≠ never`). When `load` is dependency-free you may omit it — it defaults to `Layer.empty`:

```typescript
Boundary.server(
  { load: () => Effect.succeed({ name: "Static", price: 0 }), schema: ProductSchema },
  (product) => h.div(product.name),
);
```

Omitting `provide` while `load` still has un-discharged requirements is a **compile error** — the guarantee that no server-only requirement escapes into the client.

## Bundle pruning

`load` and `provide` statically reference server-only code (the load closure and the `provide` `Layer`, e.g. `DatabaseLive`, plus their transitive imports). The `ServerTag` brand keeps that code out of the universal _types_, but on a naïve client build it still **ships** in the bundle.

`@effect-ui/vite`'s `effectUiPrune()` plugin removes that weight. On the client (non-SSR) build it strips `load`/`provide` from each `Boundary.server` call so the bundler tree-shakes the server-only subgraph away. On the SSR build it is a no-op. Since the client renderer never reads `load`/`provide` (only `schema`, `render`, and `failure`), the rewrite is behaviour-preserving.

```typescript
// vite.config.ts
import { effectUiPrune } from "@effect-ui/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [effectUiPrune()],
});
```

`effectUiPrune(options?)` accepts `include`/`exclude` (Vite `createFilter` globs/regexes). It matches `Boundary.server` calls whose first argument is an inline object literal; non-literal or spread arguments are skipped with a build warning. Namespace imports (`import * as Core`) are not matched — use a named `import { Boundary }`. Until a project adopts the plugin, the unpruned client bundle is runtime-safe, just larger.

## When to use

- **`Boundary.server`** — data that must be fetched on the server (behind a server-only service, credential, or private network) and rendered into the initial HTML, then resumed on the client without a second fetch.
- **`Boundary.suspend`** — async data that loads on the client (or streams the shell then fills); see the [Boundary API](../api/core.md#boundarysuspend).

`Boundary.server` is **replay-only**: the client reproduces the server result and does not re-run `load`. To refresh server data after hydration, reach for ordinary client services.

## See also

- [Routing](./routing.md) — `@effect-ui/router` builds on this SSR + hydration model for full-page nested routing
- [`Boundary.server` API reference](../api/core.md#boundaryserver)
- [`ServerTag` API reference](../api/core.md#servertag)
- [examples/server-boundary](../../examples/server-boundary) — a runnable product page with success and typed-failure replay, the prune plugin wired in, and an observable proof that `load` never runs on the client
- [examples/ssr-hydration](../../examples/ssr-hydration) — SSR + hydration without server data loading
