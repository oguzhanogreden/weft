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

Every combinator is **fully typed**: a route's `component` and a layout's `render`
return a precise `Node<E, R>`, the `outlet` handed to a layout carries the union
of its whole subtree's channels (plus the universal `Router` requirement and the
possible `RouterNotFound` error), and those channels aggregate up so the sealed
`RouterDef` — and `RouterApp(def)` — surface a concrete `Node` type with **no
`Node<any, any>`** on the authoring surface.

## Module map

| Module                        | Side   | Responsibility                                                               |
| ----------------------------- | ------ | ---------------------------------------------------------------------------- |
| `src/route-tree.ts`           | shared | `route()` / `layout()` combinators (exposed as `Router.*`) + node types      |
| `src/compile.ts`              | shared | walk the tree once into flat leaf descriptors + match chains                 |
| `src/matcher.ts`              | shared | compile patterns to regex, `match(path)` → leaf + decoded params/query       |
| `src/href.ts`                 | shared | type-safe URL builder from a leaf's schemas                                  |
| `src/router-service.ts`       | shared | `Router` `Context.Tag` + the merged `Router.{route,layout,router}` namespace |
| `src/errors.ts`               | shared | `RouterNotFound` tagged error + `notFound()` helper                          |
| `src/outlet.ts`               | shared | `RouterApp` / `outletNode` — nested page UI from `Router.currentMatch`       |
| `src/client/router-live.ts`   | client | `Router` `Layer` backed by the History API                                   |
| `src/client/link.ts`          | client | global same-origin click interceptor → SPA navigation                        |
| `src/server/to-http-api.ts`   | server | generate `HttpApi` from the compiled tree                                    |
| `src/server/router-server.ts` | server | per-request server `Router` + render + 404                                   |

## Authoring API

```ts
// A leaf page. `component` receives its typed { path, query }.
Router.route(segment, { path?, query?, component })

// A layout wrapping an outlet. `render` receives { path, outlet }.
Router.layout(segment, { path?, render }, children)

// Seal the tree into a RouterDef.
Router.router(root, { notFound })
```

- `segment` is **relative to the parent** and may contain `:name` path-param
  placeholders (e.g. `"users/:id"`). A leading/trailing `/` is tolerated.
- `path` / `query` are `Schema.Struct.Fields` (record of name → `Schema`). Path
  param fields default to `Schema.String` when a `:name` placeholder has no
  declared field. Query fields are all optional by default.
- A page `component` is `(args: { path, query }) => Node`. A layout `render` is
  `(args: { path, outlet }) => Node` — the `outlet` is a fully-typed `Node`
  (mirroring the route component's single args object), placed in the returned
  tree wherever the child level should appear.

## Acceptance criteria

### Tree compilation (`compile.ts`)

- **C1** `compile(def)` returns one **leaf descriptor** per `route()` in the
  tree, in document order.
- **C2** Each leaf's `fullPathPattern` is the `/`-joined concatenation of every
  ancestor segment plus its own, normalized to a single leading `/` and no
  trailing `/` (root leaf ⇒ `/`).
- **C3** Each leaf's `pathSchema` is a `Schema.Struct` merging the path fields
  declared at **every level down its branch** (leaf wins on key collision).
- **C4** Each leaf's `querySchema` is the `Schema.Struct` of its own query
  fields (empty struct when none).
- **C5** Each leaf carries its `layoutChain`: the ordered list of ancestor
  layouts (root → … → parent) plus the leaf component, used to build the nested
  UI.
- **C6** Every `:name` placeholder in any segment on the branch has a
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
  fixed-match server `Router`, and renders `document(RouterApp(def))` via
  `renderToStringHydratable`, returning `{ html, status: 200 }`.
- **S2** When no route matches (or a page raises `RouterNotFound`), the
  not-found page renders and `status` is `404`.
- **S3** The server `Router`'s `navigate` is a no-op-ish failure path (navigation
  is a client concern); `currentMatch` is the fixed match for the request.
- **S4** `toHttpApi(def)` produces an `HttpApi` with one `"pages"` group whose
  endpoints are GET endpoints, one per leaf, at each leaf's `fullPathPattern`,
  with `setPath(pathSchema)` and `setUrlParams(querySchema)`.

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
