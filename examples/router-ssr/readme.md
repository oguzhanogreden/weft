# router-ssr

A server-rendered, client-hydrated nested-routing example built on
`@effect-ui/router`.

## Overview

The app is an explicit nested route tree — a root `Shell` layout wrapping a
`/users/:id` layout, which wraps `/users/:id/settings` and `/users/:id/posts`
pages — sealed with `Router.router(...)` into a single `RouterDef` (`App`). It shows
**both** ways a node reads the live match: the **leaf pages** take **handler-arg
props** (`({ path, query }) => …` — the router passes the decoded match straight
in), while the **`/users/:id` layout** keeps **dependency injection**
(`yield* Router.params` for `:id`, `yield* Router.Outlet` for its child). The same
`App` drives both sides:

- **Server** (`entry-server.ts`): `RouterServer` matches the request URL, renders
  the matched page to hydratable HTML inside a typed document shell, and responds
  with `text/html` (HTTP 404 for unmatched routes or a page that calls
  `notFound()`).
- **Client** (`entry-client.ts`): a long-lived `ManagedRuntime.make(RouterLive(App))`
  provides the scoped `Router` (it owns the popstate listener + link interceptor,
  so it must outlive the mount), and `runtime.runPromise(hydrate(RouterApp(App), root))`
  adopts the server DOM in place, then takes over navigation via the History API.
  (Providing `RouterLive` via `Effect.provide` at the node level instead would
  strip the boundary's carried descriptor and release the scoped layer
  immediately — see `outlet.ts`.)

## Problem

SSR frameworks need one description of "URL → which page" that works on both the
server (match a request, render hydratable HTML) and the client (match
`location`, swap pages reactively) — while keeping unchanged ancestor layouts
mounted across navigations so their state and DOM survive.

## Solution

A universal route tree compiled once into flat leaf descriptors. The server
renders the matched chain to a string; the client renders the same `RouterApp`
and swaps pages by re-emitting only the outlet levels whose keys changed. Each
nesting level is a reactive **stream child** keyed by its resolved path prefix and
`dedupe`d, so an unchanged layout is never re-rendered.

## How It Works

- `app.ts` (side-effect-free) declares the tree with `Router.route()` /
  `Router.layout()` and exports the sealed `App` plus the leaf routes used for
  type-safe `href`s.
- Leaf pages read the match via **handler-arg props**: the router passes the
  decoded `{ path, query }` (`RouteHandlerProps`) into the leaf `component`, so
  `settings`/`posts` use `path.id` / `query.sort` directly. A layout sits above the
  leaf and so can't take handler args — the `/users/:id` layout keeps DI.
- The `/users/:id` layout owns a `SubscriptionRef` counter. Navigating between
  `settings` and `posts` (same `:id`) changes only the leaf level — the layout's
  DOM node and its counter persist, which the browser test asserts directly.
- Plain `h.a({ href })` links navigate as a SPA when the href resolves to a route
  (a global same-origin click interceptor installed by `RouterLive`); external,
  modified, or non-matching clicks fall through to a full load.
- `href(settingsRoute, { path: { id } })` builds type-safe URLs; the `:id` schema
  is `Schema.NumberFromString`, so params decode/encode across the wire.

### `@effect/platform` is the spine

The sealed `App` owns its authoritative `HttpApi` (`App.httpApi`, built by
`buildHttpApi` during `Router.router(...)`): one `pages` group with a GET endpoint
per leaf, carrying each leaf's `setPath` / `setUrlParams` schemas and a
`RouterNotFound → 404` error. It is the **single source of truth** both sides read:

- **Server** — `RouterServer.toWebHandler(App, { document })` dispatches through
  `HttpApiBuilder` (platform owns request→leaf matching, path/query decode, and the
  404 status); this dev server bridges that handler into Vite for HMR.
- **Client** — `RouterLive(App)` derives a real `HttpApiClient` from the same
  `App.httpApi` (exposed as `Router.httpApiClient`, default same-origin) for network
  work. SPA URL→leaf resolution stays local, fed from the same endpoint definitions.

### `Boundary.server` client refetch

`/dashboard` adds a `Boundary.server` region whose data is loaded server-side from
a **server-only** `Metrics` service (discharged inside the boundary via `provide`,
so it never reaches the client bundle). The server renders the loaded value inline
for SSR; after hydration a **Refresh** button calls `resource.refetch`, which goes
through the router's static `GET /_eui/data` endpoint — re-running `load` **on the
server** and returning the schema-encoded envelope — then patches the `#metric`
region **in place** (same DOM node, no remount, no flash). The same `App.httpApi`
spine that serves pages also serves this data endpoint, and the same `HttpApiClient`
`RouterLive` derives backs the refetch (via the core `BoundaryDataClient` transport
seam). `load` never runs in the browser. The co-located `refetch.browser.test.ts`
drives the full round-trip in a real browser, delegating the same-origin
`/_eui/data` fetch to `RouterServer.toWebHandler`.

### Programmatic navigation

Beyond plain `h.a({ href })` links, `@effect-ui/router/client` exposes typed
programmatic navigation — `navigate(ref, args)`, `push` / `replace`, `back` /
`forward`, and `setQuery` / `patchQuery` — plus reactive `Router.paramsStream` /
`Router.queryStream` accessors that update in place across query-only changes. The
co-located `navigation.browser.test.ts` drives all of these in a real browser.

## Running

```bash
vp run dev          # from the repo root or this folder — http://localhost:3200
vp run test:browser # app.browser.test.ts + navigation.browser.test.ts + refetch.browser.test.ts
```

## When to Use

Reach for `@effect-ui/router` when you need universal nested routing with SSR +
hydration: deep route trees, persistent layouts, type-safe params/queries, and
`location`-driven page swaps. For server-loaded data that the client can refresh
after hydration, wrap it in a `Boundary.server` and call `resource.refetch` (see
`/dashboard` above). For client-first post-navigation data (no SSR payload), prefer
`Boundary.suspend` — client-first mount of `Boundary.server` is out of scope for v1
(see `packages/router/router.specs.md`).
