# router-client

A client-only SPA built on `@weftui/router`: no server, no SSR, no `Boundary.rpc`.
It is the client-side counterpart to [`examples/router-ssr`](../router-ssr): same
router primitives, minus the server render and the rpc data boundary.

## Overview

The whole app is one sealed `Router.router(...)` tree (`App`, in `app.ts`), mounted
directly with `WeftApp.mount` (`main.ts`). Three routes sit under one persistent
`Shell` layout:

- **`/`** (`homeRoute`): a static landing page.
- **`/users`** (`usersRoute`): a user listing with a `?sort=asc|desc` **query
  param**, read reactively via `Router.queryStream` so a sort link re-orders the
  list in place without remounting the page.
- **`/users/:id`** (`userRoute`): a user detail page with an `:id` **path
  param**, decoded with `Schema.NumberFromString` into typed handler-arg props.
  An unknown id calls `notFound()` for a dynamic 404.

`app.ts` is side-effect-free: it exports `App` and the leaf route refs so
`main.ts` and the co-located `app.browser.test.ts` can mount it independently.

## Problem

A client-only SPA still needs everything a "real" router gives you: nested
pages, typed path/query params, a layout that survives navigation, and links
that don't trigger a full page reload. Hand-rolling that means wiring
`popstate`, intercepting clicks, parsing `location.search`, and re-deriving
types for each route by hand, all without any server to lean on for the initial
render.

## Solution

Author the same explicit `Router.route` / `Router.layout` / `Router.router`
tree the SSR side uses, then drive it from the client only:

```typescript
import { WeftApp } from "@weftui/dom/client";
import { RouterApp, RouterLive } from "@weftui/router/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

const app = WeftApp.make(RouterLive(App));
void Effect.runPromise(WeftApp.mount(app, RouterApp(App), root));
```

`RouterLive(App)` provides the History-API-backed `Router` (seeded from
`window.location`, same-origin link-click interceptor installed) with no `rpc`
option, since this app has no `Boundary.rpc`. `WeftApp.mount` renders
`RouterApp(App)` fresh into `#root`, in contrast to `router-ssr`'s
`WeftApp.hydrate`, which adopts server-rendered markup instead.

## How It Works

- **Link interception**: every nav/list link is a plain `h.a({ href: href(...) })`
  built from a sealed route ref. Clicking one navigates via the History API,
  no full page load, no manual click handler.
- **Layout persistence**: `Shell` reads `yield* Router.Outlet` once and renders
  the header/nav around it. Its DOM node is never re-created across
  navigations; only the outlet swaps.
- **Path params**: `userRoute` declares `path: { id: Schema.NumberFromString }`,
  so its `component: ({ path }) => …` receives `path.id` already decoded to a
  `number`. Looking up an id with no matching user calls `notFound(...)`,
  which renders the app's `notFound` page and would 404 on a server.
- **Reactive query params**: `usersRoute` declares `query: sortQuery` and reads
  it with `Router.queryStream(sortQuery)` instead of the handler-arg `query`.
  That resolves a `Subscribable`, so sorting via `?sort=asc`/`?sort=desc`
  re-renders just the `<ul>` in place: the leaf itself never remounts.
- **Sealing**: `Router.router(Router.layout({ component: Shell }, [...]), { notFound })`
  compiles the tree once, which is what makes every `href(...)` call above
  type-check against the route's actual path/query schema.

## Running

```bash
vp run dev          # http://localhost:5173 (or whatever port Vite picks)
vp run test:browser # app.browser.test.ts: interception, persistence, params, sort, 404
```

## When to Use

Reach for this shape, `Router.router` + `RouterLive` + `WeftApp.mount`, whenever
you're building a client-only SPA that still wants typed nested routes, a
persistent layout, and History-API navigation, but has no server to render or
hydrate from. See the [Routing how-to](../../docs/how-to/add-routing.md)'s
["Client-only app"](../../docs/how-to/add-routing.md#client-only-app) section
for the same wiring as a minimal, from-scratch walkthrough.

If you later need server rendering, hydration, or server-resolved data that the
client can refresh (`Boundary.rpc`), see [`examples/router-ssr`](../router-ssr):
the route tree and component patterns here carry over unchanged, only the entry
points and the mount call (`WeftApp.hydrate` instead of `WeftApp.mount`) differ.
