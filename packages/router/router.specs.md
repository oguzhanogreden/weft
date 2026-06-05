# `@effect-ui/router` — Specifications

## Overview

`@effect-ui/router` is a universal (server + client) nested router for effect-ui.
It maps a URL to a rendered `Node` tree on both sides:

- **Server** matches an incoming request path, builds a fixed `Router` for that
  request, renders the matched nested page to hydratable HTML, and responds with
  `text/html` (HTTP 404 for not-found).
- **Client** matches `window.location`, swaps pages reactively via the History
  API, and persists unchanged ancestor layouts across navigations.

The package mirrors `packages/dom`: a shared (universal) root, a `./client`
entry, and a `./server` entry.

### Route model — component-as-handler

A route's **component is its handler**. The endpoint carries only the routing
contract (path-param schema + query schema). There is no per-route success-data
schema / loader in v1 — server-only data stays with `Boundary.server`, and
client-side async with `Boundary.suspend`.

### Authoring surface — explicit nested route tree

The tree is authored with the namespaced `Router.layout(...)` and
`Router.route(...)` combinators and sealed with `Router.router(...)` (mirroring
the namespaced core surface — `Component.gen`, `Boundary.catchTag`, `h.div`). The
`Router` symbol is both the service `Context.Tag` (`yield* Router`) and the
authoring namespace; the two roles merge by declaration. The tree is the source
of truth. `HttpApi` is the **compilation target** (generated from the tree by
`toHttpApi`), never the authoring surface.

Every combinator is **fully typed**: a route's and a layout's `component` slot is
a thunk `() => Node<E, R>` (authored with `Component.make` / `Component.gen`, or a
plain `() => Effect.gen(…)`) that the router invokes at render time — mirroring the
`notFound: () => Node` slot, and deferring construction so `href(…)` runs after the
tree is compiled. Those channels aggregate up so the sealed `RouterDef` — and
`RouterApp(def)` — surface a concrete `Node` type with **no `Node<any, any>`** on
the authoring surface.

### Dependency-injection surface

The outlet and the current match's params/query are delivered by **dependency
injection**, not callback arguments:

- **`Router.Outlet`** — a `Context.Tag` whose value is the node to splice. A
  layout's `component` thunk reads it with `const outlet = yield* Router.Outlet`
  and places `[outlet]` like an `h`-style child; the server document shell thunk
  does the same to place the app. It is typed **opaque** as `Node<never, never>` so
  splicing adds nothing to
  the reader's local channels — the subtree's real `E`/`R` are aggregated
  structurally by `Router.layout` / `Router.router`. The router discharges it via
  `Effect.provideService(node, Router.Outlet, …)` at render time, so it is
  **excluded** from a layout's (and the document's) aggregate requirement channel.
- **`Router.params(fields)` / `Router.query(fields)`** — validating accessors that
  read the **live match** (`yield* Router` → `currentMatch.get`), pick the
  requested `fields` keys from the decoded path/query, and validate them against
  the `Type` side of `Schema.Struct(fields)`. They return the typed values, or
  fail with a tagged **`RouterParamsError`** (`source: "path" | "query"`, plus the
  requested `keys`) when no route matches or a key is missing/invalid. Any
  component — not just the leaf — may read them; the `RouterParamsError` bubbles to
  the app node's `E` (a user may `Boundary.catchTag("RouterParamsError", …)`).

## Module map

| Module                        | Side   | Responsibility                                                              |
| ----------------------------- | ------ | --------------------------------------------------------------------------- |
| `src/route-tree.ts`           | shared | `route()` / `layout()` combinators (exposed as `Router.*`) + node types     |
| `src/compile.ts`              | shared | walk the tree once into flat leaf descriptors + match chains                |
| `src/matcher.ts`              | shared | compile patterns to regex, `match(path)` → leaf + decoded params/query      |
| `src/href.ts`                 | shared | type-safe URL builder from a leaf's schemas                                 |
| `src/router-service.ts`       | shared | `Router` `Context.Tag` + `Router.{route,layout,router,Outlet,params,query}` |
| `src/errors.ts`               | shared | `RouterNotFound` + `RouterParamsError` tagged errors + `notFound()` helper  |
| `src/outlet.ts`               | shared | `RouterApp` / `outletNode` — nested page UI from `Router.currentMatch`      |
| `src/client/router-live.ts`   | client | `Router` `Layer` backed by the History API                                  |
| `src/client/link.ts`          | client | global same-origin click interceptor → SPA navigation                       |
| `src/server/to-http-api.ts`   | server | generate `HttpApi` from the compiled tree                                   |
| `src/server/router-server.ts` | server | per-request server `Router` + render + 404                                  |

## Authoring API

```ts
// A leaf page. `component` is a ComponentSlot reading params via Router.params/query.
Router.route(segment, { path?, query?, component })

// A layout wrapping an outlet. `component` is a ComponentSlot splicing Router.Outlet.
// A layout owns no path/segment — it is purely UI nesting.
Router.layout({ component }, children)

// Seal the tree into a RouterDef.
Router.router(root, { notFound })
```

- `segment` is a **route-only** argument, **relative to the parent** and may
  contain `:name` path-param placeholders (e.g. `"users/:id"`). A leading/trailing
  `/` is tolerated. Each child route carries its **full relative path** down to the
  leaf (e.g. `"users/:id/settings"`).
- **Layouts have no `segment` or `path`** — they only wrap an outlet (purely UI
  nesting); all path structure lives on routes. A layout that needs a param reads
  it via `Router.params`.
- `path` / `query` are `Schema.Struct.Fields` (record of name → `Schema`) declared
  **only on routes**. The compiler covers every `:name` on the route's pattern in
  the leaf's `pathSchema`, defaulting to `Schema.String` when a placeholder has no
  declared field. Query fields are all optional by default.
- Both a page's and a layout's `component` is a **`ComponentSlot`** — a callable
  producing a `Node`, passed **uncalled**: a `Component.make(() => …)` /
  `Component.gen(function* () { … })` component, or a plain `() => Node` thunk (e.g.
  `() => Effect.gen(…)`). The router invokes it per render: a page reads
  `Router.params` / `Router.query`; a layout splices `yield* Router.Outlet` wherever
  the child level should appear. Its `E`/`R` channels are recovered (via `SlotNode`)
  and propagate up the tree. The callable form matches `notFound` and defers `href`
  resolution to render time.

## Acceptance criteria

### Tree compilation (`compile.ts`)

- **C1** `compile(def)` returns one **leaf descriptor** per `route()` in the
  tree, in document order.
- **C2** Each leaf's `fullPathPattern` is the `/`-joined concatenation of the
  **route** segments on its branch (layouts contribute none), normalized to a
  single leading `/` and no trailing `/` (root leaf ⇒ `/`).
- **C3** Each leaf's `pathSchema` is a `Schema.Struct` merging the path fields
  declared at **every level down its branch** (leaf wins on key collision).
- **C4** Each leaf's `querySchema` is the `Schema.Struct` of its own query
  fields (empty struct when none).
- **C5** Each leaf carries its `layoutChain`: the ordered list of ancestor
  layouts (root → … → parent) plus the leaf component, used to build the nested
  UI. Each layout's dedupe `patternPrefix` is the **longest common path prefix of
  the leaves in its subtree** (so an ancestor layout persists across navigation and
  re-renders only when a param shared by all its leaves changes).
- **C6** Every `:name` placeholder in a **route** segment on the branch has a
  corresponding key in `pathSchema` (defaulted to `Schema.String` if not
  declared).

### Matching (`matcher.ts`)

- **M1** A static pattern (`/about`) matches exactly that path and nothing else.
- **M2** A path-param pattern (`/users/:id`) matches `/users/42`, capturing
  `id = "42"` (raw), then decoded via `pathSchema` (e.g. to `number`).
- **M3** Trailing slashes are normalized: `/users/42` and `/users/42/` match the
  same leaf.
- **M4** Query strings decode through `querySchema` (`Schema.decode`); absent
  optional keys are omitted/undefined.
- **M5** No matching leaf ⇒ `match` returns `Option.none()` (router falls back to
  the not-found page).
- **M6** More specific (static) segments win over param segments at the same
  position (e.g. `/users/new` beats `/users/:id` when both exist).
- **M7** A path-param decode failure (e.g. `:id` is `Schema.NumberFromString`
  and the value is `"abc"`) ⇒ no match (`Option.none()`), not a thrown error.
- **M8** A query decode failure (a **declared** query field whose value violates
  its schema, e.g. `?page=abc` for `Schema.NumberFromString`) ⇒ no match, like a
  path decode failure — not a thrown error. Excess/undeclared query keys are
  ignored by `Schema.Struct`, so only declared-but-invalid values fall through.

### `href` (`href.ts`)

- **H1** `href(leafRef, { path, query })` encodes path params into the pattern
  (`/users/:id` + `{ id: 42 }` ⇒ `/users/42`).
- **H2** Query values encode through the query schema into a search string,
  sorted by key for stability; absent optional values are omitted.
- **H3** `href` round-trips with `match`: `match(href(ref, args))` yields back
  the same leaf and `args`.
- **H4** Path params are **required** in `href`'s argument type; query is
  optional when every query field is optional.

### Outlet persistence (`src/outlet.ts`)

- **O1** `RouterOutlet` renders the nested chain for the current match: each
  layout wraps the next level's outlet, the leaf renders the page.
- **O2** Each layout level is a reactive **stream child** keyed by
  `(pattern + the param values that level depends on)` and `dedupe`d, so an
  unchanged ancestor layout stays mounted across a navigation that only changes a
  deeper level.
- **O3** Navigating to a sibling under the same layout swaps **only** the inner
  outlet; the layout DOM node identity is preserved.

### Server render + 404 (`server/router-server.ts`)

- **S1** `RouterServer.render(def, { document, url })` matches `url`, builds a
  fixed-match server `Router`, injects `RouterApp(def)` into the `document` shell
  via `Router.Outlet`, and renders it via `renderToStringHydratable`, returning
  `{ html, status: 200 }`. `document` is a `ComponentSlot` (the same callable form
  as the route/layout `component` slot — a plain `() => Node` thunk or a
  `Component.make` / `Component.gen` component); `render` provides both `Router.Outlet`
  (the app, per request) and `Router`, so the shell may use either.
- **S2** When no route matches (or a page raises `RouterNotFound`), the
  not-found page renders and `status` is `404`.
- **S3** The server `Router`'s `navigate` is a no-op-ish failure path (navigation
  is a client concern); `currentMatch` is the fixed match for the request.
- **S4** `toHttpApi(def)` produces an `HttpApi` with one `"pages"` group whose
  endpoints are GET endpoints, one per leaf, at each leaf's `fullPathPattern`,
  with `setPath(pathSchema)` and `setUrlParams(querySchema)`.

### Dependency injection (`router-service.ts`, `outlet.ts`)

- **D1** A layout's `component` thunk reads its outlet via `yield* Router.Outlet`; the router
  provides it per render, and the layout's aggregate `R` (and the sealed app's `R`)
  **excludes** `Router.Outlet`.
- **D2** `Router.params(fields)` returns the live match's decoded path params for
  the requested `fields`, typed as `Schema.Struct.Type<fields>`; `Router.query`
  does the same for the query. Both are readable from **any** component, not just
  the leaf.
- **D3** `Router.params` / `Router.query` fail with a `RouterParamsError`
  (`source: "path" | "query"`, carrying the requested `keys`) when no route is
  matched or a requested key is missing / fails `Type`-side validation. The error
  bubbles into the app node's aggregate `E`.
- **D4** A layout declares **no** `path`; a `:name` introduced by a layout segment
  is keyed on the leaf's `pathSchema` (defaulted to `Schema.String`), and a layout
  that needs the value reads it via `Router.params`.

### Not-found (`errors.ts`)

- **N1** `notFound()` returns an `Effect` failing with `RouterNotFound`.
- **N2** `RouterNotFound` is exported so a user can place a
  `Boundary.catchTag("RouterNotFound", …)` to override the fallback for a subtree.
- **N3** The router config's `notFound` page renders for both "no route matched"
  and an uncaught `RouterNotFound` raised by a page.

### Link interception (`client/link.ts`)

- **L1** A plain `h.a({ href })` to a same-origin, route-matching URL performs
  SPA navigation (no full page load) when clicked.
- **L2** Modified clicks (ctrl/meta/shift/alt, non-left button), `target=_blank`,
  `download`, external origins, and non-matching hrefs fall through to a full
  load (interceptor does not call `preventDefault`).
- **L3** The interceptor is attached for the lifetime of the `Router` layer scope
  and detached on teardown.

### Param / query decode on both sides

- **P1** On the server, the matched leaf's `path`/`query` decode once per request
  and are exposed via the fixed `Router` and the page `component` args.
- **P2** On the client, navigation re-decodes `path`/`query` for the new match
  and re-renders the affected outlet level(s) only.
- **P3** A server-only dependency referenced in client (`render`) code is rejected
  by `AssertNoServerOnly` at the `hydrate` call site (inherited from
  `@effect-ui/dom/client`).

## `Boundary.server` interplay (documented limitation)

Initial SSR navigation works end to end (server renders + inline payload, client
replays during `hydrate`). **Client-side** navigation to a page containing
`Boundary.server` has no server payload — it surfaces via the existing
recoverable hydration path. The recommended pattern for post-navigation data is
`Boundary.suspend`. Server-data-on-client-navigation is explicitly **out of v1
scope**, consistent with `Boundary.server` being replay-only.
