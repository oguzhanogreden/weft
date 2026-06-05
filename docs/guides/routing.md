# Routing

`@effect-ui/router` is a universal (server + client) nested router for effect-ui. It maps a URL to a rendered `Node` tree on both sides:

- **Server** — matches an incoming request path, renders the matched nested page to hydratable HTML, and responds with `text/html` (HTTP 404 for not-found).
- **Client** — matches `window.location`, swaps pages reactively via the History API, and keeps unchanged ancestor layouts mounted across navigations.

The package mirrors `@effect-ui/dom`: a shared (universal) root, a `./client` entry, and a `./server` entry.

```bash
npm install @effect-ui/router
```

## The mental model

A route's **component is its handler**. There is no separate loader or per-route data schema — a page is just a component that renders. Server-only data stays with [`Boundary.server`](./server-side-rendering.md); client-side async stays with `Boundary.suspend`.

You author an **explicit nested route tree** with three namespaced combinators — mirroring the `h.div` / `Component.gen` / `Boundary.catchTag` surface — and seal it once:

| Combinator                                            | Builds                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `Router.route(segment, { path?, query?, component })` | A leaf page.                                                      |
| `Router.layout({ component }, children)`              | A layout that wraps an outlet (purely UI nesting — owns no path). |
| `Router.router(root, { notFound })`                   | Seals the tree into a `RouterDef`.                                |

The tree is the source of truth. The same sealed `RouterDef` drives both server and client.

## Authoring routes

Every `component` slot is a **`ComponentSlot`** — a callable producing a `Node`, passed **uncalled**. Use [`Component.make` / `Component.gen`](./component-authoring.md) (or a plain `() => Node` thunk). The router invokes it at render time, which is what lets `href(…)` resolve after the tree is compiled.

```typescript
import { Component, h } from "@effect-ui/core";
import { Router } from "@effect-ui/router";
import { Schema } from "effect";

const About = Router.route("about", {
  component: Component.make(() => h.h1("About")),
});

const User = Router.route("users/:id", {
  path: { id: Schema.NumberFromString },
  component: Component.gen(function* () {
    const { id } = yield* Router.params({ id: Schema.NumberFromString });
    return yield* h.div(`User ${id}`);
  }),
});
```

- **`segment`** is relative to the parent and may contain `:name` path-param placeholders (e.g. `"users/:id"`). A leading/trailing `/` is tolerated. Each leaf carries its full relative path (e.g. `"users/:id/settings"`).
- **`path` / `query`** are `Schema.Struct.Fields` (a record of `name → Schema`), declared **only on routes**. The compiler covers every `:name` placeholder in `pathSchema`, defaulting to `Schema.String` when a placeholder has no declared field. Query fields are optional by default.

> Authoring components with `Component.make` / `Component.gen` keeps every slot fully typed: the router never sees a `Node<any, any>`, and each component's `E`/`R` channels aggregate up through `Router.layout` / `Router.router` into the sealed `RouterDef`.

## Params and query by dependency injection

The current match's params and query are delivered by **dependency injection**, not callback arguments. Any component — not just the leaf — reads them:

```typescript
import { Schema } from "effect";

const idParam = { id: Schema.NumberFromString };
const sortQuery = { sort: Schema.optional(Schema.String) };

Router.route("users/:id/posts", {
  path: idParam,
  query: sortQuery,
  component: Component.gen(function* () {
    const { id } = yield* Router.params(idParam);
    const { sort } = yield* Router.query(sortQuery);
    return yield* h.section({ id: "page" }, [
      h.h2(`Posts for user ${id}`),
      h.p(`sort: ${sort ?? "none"}`),
    ]);
  }),
});
```

`Router.params(fields)` / `Router.query(fields)` read the live match, pick the requested `fields` keys, and validate them against `Schema.Struct(fields)`. They return the typed values, or fail with a tagged [`RouterParamsError`](#errors) (carrying `source: "path" | "query"` and the requested `keys`) when no route matches or a key is missing/invalid. That error bubbles into the app node's aggregate `E`, so a user may recover it with `Boundary.catchTag("RouterParamsError", …)`.

## Layouts and the outlet

A **layout** wraps the next level down — the **outlet** — which is also delivered by injection. A layout reads it with `yield* Router.Outlet` and places it like any `h`-style child:

```typescript
const UserShell = Component.gen(function* () {
  const { id } = yield* Router.params(idParam);
  const outlet = yield* Router.Outlet;
  return yield* h.div({ class: "user" }, [h.h1(`User ${id}`), outlet]);
});

Router.layout({ component: UserShell }, [settingsRoute, postsRoute]);
```

`Router.Outlet` is typed **opaque** (`Node<never, never>`), so splicing it adds nothing to the layout's own channels — the subtree's real `E`/`R` are aggregated structurally by `Router.layout`. The router discharges the `Outlet` requirement at render time, so it never appears in a layout's (or the sealed app's) aggregate requirement channel.

A layout owns **no `segment` or `path`** — all path structure lives on routes. A layout that needs a param simply reads it via `Router.params`.

### Layout persistence

Each nesting level renders as a reactive stream child keyed by `(pattern + the param values that level depends on)` and `dedupe`d. An unchanged ancestor layout therefore **stays mounted** across a navigation that only changes a deeper level: its DOM identity and any local state (a `SubscriptionRef`, a scroll position) survive while only the inner outlet swaps.

## Sealing the tree

`Router.router(root, { notFound })` compiles the tree eagerly (stamping leaf references so `href` works) and captures the app-level not-found page:

```typescript
export const App = Router.router(
  Router.layout({ component: Shell }, [
    homeRoute,
    Router.layout({ component: UserShell }, [settingsRoute, postsRoute]),
  ]),
  { notFound: () => h.section({ id: "page" }, [h.h2("404 — page not found")]) },
);
```

`App` is a `RouterDef` whose phantom `E`/`R` carry the aggregate channels of the whole tree (plus the not-found page) — keep `app.ts` side-effect-free (no `mount`/`hydrate`) so both entries can import it.

## Type-safe links with `href`

`href(leafRef, args)` builds a URL from a leaf route reference (the value returned by `Router.route`). Path params are **required** in the argument type and query is optional when every query field is optional:

```typescript
import { href } from "@effect-ui/router";

const Home = Component.make(() =>
  h.nav([
    h.a({ href: href(settingsRoute, { path: { id: 1 } }) }, "User 1 settings"),
    h.a({ href: href(postsRoute, { path: { id: 2 }, query: { sort: "new" } }) }, "User 2 posts"),
  ]),
);
```

Path params encode into the pattern (`/users/:id` + `{ id: 42 }` ⇒ `/users/42`); query values encode through the query schema into a key-sorted search string. `href` round-trips with the matcher. The leaf must belong to a tree sealed with `Router.router()` (which is why deferring the `component` body via `Component.make` matters — `href` runs at render time, after compile).

## Not-found

`notFound(path?)` short-circuits the current render with a `RouterNotFound` failure (Next.js-style). Callable from any page or layout; the nearest enclosing not-found boundary renders the configured `notFound` page in its place, and the server responds with HTTP 404:

```typescript
import { notFound, Router } from "@effect-ui/router";

Router.route("users/:id", {
  path: idParam,
  component: Component.gen(function* () {
    const { id } = yield* Router.params(idParam);
    if (id < 0) return yield* notFound();
    return yield* h.div(`User ${id}`);
  }),
});
```

`RouterNotFound` is exported, so a `Boundary.catchTag("RouterNotFound", …)` placed inside a subtree overrides the app-level fallback for that subtree (the router's internal boundary is outermost, so a nearer user boundary wins).

## Client setup

On the client, provide the `Router` via `RouterLive(def)` and render `RouterApp(def)`. `RouterLive` is a **scoped layer** — it owns the `popstate` listener and the same-origin link-click interceptor — so it must outlive the mount. Provide it through a long-lived `ManagedRuntime` rather than `Effect.provide` at the node level:

```typescript
// entry-client.ts
import { hydrate } from "@effect-ui/dom/client";
import { RouterApp, RouterLive } from "@effect-ui/router/client";
import { ManagedRuntime } from "effect";
import { App } from "./app";

const root = document.getElementById("root")!;
const runtime = ManagedRuntime.make(RouterLive(App));
void runtime.runPromise(hydrate(RouterApp(App), root));
```

For a client-only app (no SSR), swap `hydrate` for `mount` — everything else is identical.

### Link interception

A plain `h.a({ href })` to a same-origin, route-matching URL performs SPA navigation when clicked — no full page load. The interceptor leaves the browser's native behaviour untouched for modified clicks (ctrl/meta/shift/alt or non-left button), `target=_blank`, `download`, external origins, same-document (hash-only) navigations, and hrefs that don't resolve to a route. You don't wire anything up: `RouterLive` installs the delegated listener for the layer's lifetime and removes it on teardown.

## Server setup

On the server, `RouterServer` matches a request URL, builds a fixed-match `Router`, renders `RouterApp` to hydratable HTML inside a **document shell**, and reports a status (404 when no route matches or a page raises `RouterNotFound`).

The document shell is itself a `ComponentSlot` that splices the app via `yield* Router.Outlet` — exactly like a layout receives its outlet:

```typescript
// entry-server.ts
import { Component, h } from "@effect-ui/core";
import { Router } from "@effect-ui/router";
import { RouterServer } from "@effect-ui/router/server";
import { Effect } from "effect";
import { App } from "./app";

const documentShell = Component.gen(function* () {
  const app = yield* Router.Outlet;
  return yield* h.html({ lang: "en" }, [
    h.head([h.meta({ charset: "utf-8" }), h.title("My app")]),
    h.body([
      h.div({ id: "root" }, [app]),
      h.script({ type: "module", src: "/src/entry-client.ts" }),
    ]),
  ]);
});

// { html, status } — `<!DOCTYPE html>` is prepended for you.
export const render = (url: string) =>
  Effect.runPromise(RouterServer.render(App, { document: documentShell, url }));

// Or a Web fetch-style handler, ready to bridge into Vite or any Web server.
export const handler = RouterServer.toWebHandler(App, { document: documentShell });
```

`render` provides both `Router.Outlet` (the app, per request) and `Router` (so the shell may read params), and renders through `renderToStringHydratable` so the client can `hydrate` in place.

### `@effect/platform` compilation target

The tree is the authoring surface; `HttpApi` is the **compilation target**. `toHttpApi(def)` (from `@effect-ui/router/server`) generates a flat `HttpApi` — a single `"pages"` group with one GET endpoint per leaf at its full path pattern, carrying `setPath(pathSchema)` and `setUrlParams(querySchema)` — for serving via `HttpApiBuilder` or deriving an `HttpApiClient`.

## Errors

| Error               | Raised by                                                             | Recover with                                                                |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `RouterNotFound`    | `notFound()`, or no route matched                                     | `Boundary.catchTag("RouterNotFound", …)` (or the app-level `notFound` page) |
| `RouterParamsError` | `Router.params` / `Router.query` on a missing/invalid key or no match | `Boundary.catchTag("RouterParamsError", …)`                                 |

Both are modeled as `Schema.TaggedError`, so they encode/decode across the wire the same way `Boundary.server` replays typed failures.

## `Boundary.server` interplay

Initial SSR navigation works end to end: the server renders and inlines the `Boundary.server` payload, and the client replays it during `hydrate`. **Client-side** navigation to a page containing `Boundary.server` has no server payload — it surfaces via the recoverable hydration path. For post-navigation data, prefer `Boundary.suspend`. Server-data-on-client-navigation is out of v1 scope, consistent with `Boundary.server` being replay-only.

## See also

- [`@effect-ui/router` API reference](../api/router.md)
- [examples/router-ssr](../../examples/router-ssr) — a runnable SSR + hydration app with nested layouts, persistent layout state, type-safe `href`s, and the `@effect/platform` compilation target
- [Component Authoring](./component-authoring.md) — `Component.make` / `Component.gen`, the idiomatic way to write route components
- [Server-Side Rendering](./server-side-rendering.md) — `renderToStringHydratable`, `hydrate`, and `Boundary.server`
- [`packages/router/router.specs.md`](../../packages/router/router.specs.md) — the full specification
