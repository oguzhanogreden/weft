# server-boundary

A live demo of `Boundary.server` for `@effect-ui/dom`: a server-only data
dependency co-located inside a universal tree, replayed on the client during
hydration without ever re-running the server `load`.

## Overview

A product page whose data lives behind a **server-only** `Database` service. The
page is wrapped in a single `Boundary.server`. On the server the boundary runs
`load` (reading `Database`, supplied via `provide`), serializes the product
inline as `<script type="application/json">`, and renders the product HTML in
place. In the browser, `hydrate` **decodes that payload and replays it** — it
re-runs `render(product)` against the adopted DOM but never runs `load` and never
touches `Database`.

## Problem

SSR + hydration gives you universal rendering, but a component that needs
server-only data (a database handle, a secret, a filesystem read) has nowhere to
put it: running that dependency on the client is impossible (or unsafe), so today
you must fetch outside the tree and thread the result down through props — losing
co-location and the type-level guarantee that the dependency never escapes to the
client.

## Solution

`Boundary.server` lets the component declare its server-only dependency inline:

```ts
Boundary.server(
  {
    load: () => Effect.flatMap(Database, (db) => db.getProduct()), // server-only
    provide: DatabaseLive,                                         // discharges Database here
    schema: Product,                                               // wire contract
  },
  (product) => /* universal render(product) */,
);
```

- `provide` discharges the server-only requirement **at the boundary**, so the
  resulting node's requirement channel is `never` — `hydrate(App(), root)`
  compiles and runs on the client with no `Database` in scope.
- `Database` is a `ServerTag`, so accidentally referencing it in `render` (or
  leaking it to `hydrate`) is a **compile error** via `AssertNoServerOnly`.
- The loaded value is serialized through `schema` and replayed on the client, so
  server and client `render` see structurally identical data — byte-identical
  markup, no flash.

## How It Works

- **Server** (`server.ts` → `src/entry-server.ts`):
  `renderToStringHydratable(App())` hits the `Boundary.server`, runs
  `Effect.provide(load(), DatabaseLive)` to get the product, `Schema.encode`s +
  `JSON.stringify`s it, and emits `<script type="application/json">…</script>` at
  the region cursor (XSS-safely escaped) followed by the product HTML. The inner
  reactive quantity region also gets the usual `<!-- stream-start-N -->` /
  `<!-- stream-end-N -->` markers.
- **Client** (`src/entry-client.ts`): `hydrate(App(), #root)` walks the tree in
  lockstep with the existing DOM. At the boundary it reads the inline payload,
  `JSON.parse` → `Schema.decode` → `product`, hydrates `render(product)` against
  the adopted nodes, and steps over/removes the payload script. `load` never runs
  on the client. The quantity region resumes flash-free because the server and
  client first emissions (`1`) match, then the +/- buttons become interactive.

## When To Use

Reach for `Boundary.server` when a component needs data that can only be produced
on the server — a database/ORM call, a secret-bearing API client, a filesystem or
env read — and you want that dependency **co-located** with the component that
uses it, discharged on the server, and statically prevented from leaking into the
client bundle's type surface. For data that is freely available on both sides,
plain props or a normal reactive source are simpler.

## Typed-failure replay

A `load` _failure_ replays too. Give the boundary a `failure` schema (required
once `load` can fail) and wrap it in a failure `Boundary`:

```ts
Boundary.catchAll({ fallback: (e: ProductLoadError) => /* … */ }, [
  Boundary.server(
    {
      load: () => Effect.fail(new ProductLoadError({ reason: "…" })),
      provide: Layer.empty,
      schema: Product,
      failure: ProductLoadError, // wire contract for the typed error
    },
    (product) => /* … success render … */,
  ),
]);
```

On the server the typed error propagates to the enclosing `catchAll`, which
renders its fallback and emits an inline
`<script type="application/json" data-eui-boundary-failure>` carrying the encoded
error (plus the failing boundary's index). On the client `hydrate` decodes that
payload and re-raises the **same** typed error into the **same** `catchAll`,
reproducing the identical fallback DOM — flash-free and **without re-running
`load`** (replay, never retry). A `load` _defect_ (a `Die`, not an expected
typed error) is not replayed: it propagates as before. `FailingApp` in `app.ts`
demonstrates the round-trip (see `app.failure.browser.test.ts`).

## Bundle pruning

The `ServerTag` brand keeps `Database` out of the client's _types_, but the
universal `Boundary.server` node still statically references its `load` thunk and
`provide` `Layer` (`DatabaseLive`) — so on a naive client build they (and their
transitive imports) ship to the browser even though `hydrate` never runs them.

This example's `vite.config.ts` wires `effectUiPrune()` from `@effect-ui/vite`,
which on the **client (non-SSR) build** strips the `load` and `provide` keys from
each `Boundary.server` call, letting the bundler tree-shake the server-only code.
It is `apply: "build"` so it is inert in the dev SSR flow above; the SSR build
keeps every key (the server reads them).

## How to run

```bash
vp run -F server-boundary dev
```

Then open <http://localhost:3101>.

## What to observe

- `curl -s http://localhost:3101` shows the full product HTML **plus** an inline
  `<script type="application/json">` payload — proving the page is complete
  before any JS runs (works with JavaScript disabled) and the replay data is
  embedded.
- In the browser, the product is visible immediately (server markup). After
  hydration the status flips to `[hydrated — interactive]` and the +/- quantity
  buttons work, with no flicker of the product node — and the client made **no**
  `Database` call.
