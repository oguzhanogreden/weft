# router-ssr

A server-rendered, client-hydrated nested-routing example built on
`@effect-ui/router`.

## Overview

The app is an explicit nested route tree — a root `Shell` layout wrapping a
`/users/:id` layout, which wraps `/users/:id/settings` and `/users/:id/posts`
pages — sealed with `Router.router(...)` into a single `RouterDef` (`App`). The same
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
- The `/users/:id` layout owns a `SubscriptionRef` counter. Navigating between
  `settings` and `posts` (same `:id`) changes only the leaf level — the layout's
  DOM node and its counter persist, which the browser test asserts directly.
- Plain `h.a({ href })` links navigate as a SPA when the href resolves to a route
  (a global same-origin click interceptor installed by `RouterLive`); external,
  modified, or non-matching clicks fall through to a full load.
- `href(settingsRoute, { path: { id } })` builds type-safe URLs; the `:id` schema
  is `Schema.NumberFromString`, so params decode/encode across the wire.

### `@effect/platform` compilation target

`toHttpApi(App)` (from `@effect-ui/router/server`) generates a flat `HttpApi` —
one `pages` group with a GET endpoint per leaf — for serving via `HttpApiBuilder`
or deriving an `HttpApiClient`. This dev server uses the simpler
`RouterServer.toWebHandler(App, { document })` (`Request → Response`) bridged into
Vite for HMR.

## Running

```bash
vp run dev          # from the repo root or this folder — http://localhost:3200
vp run test:browser # runs the co-located app.browser.test.ts
```

## When to Use

Reach for `@effect-ui/router` when you need universal nested routing with SSR +
hydration: deep route trees, persistent layouts, type-safe params/queries, and
`location`-driven page swaps. For post-navigation data on the client, prefer
`Boundary.suspend` — server-data-on-client-navigation is out of scope for v1 (see
`packages/router/router.specs.md`).
