# Router rebuild — make `@effect/platform` HttpApi the real spine

## Context

`@effect-ui/router` was meant to be a **thin layer over `@effect/platform` HttpApi**. It
is not. Investigation found platform is touched in exactly **one file**
(`server/to-http-api.ts`) and that file's output `HttpApi` is consumed by **nothing**
but its own test + a barrel re-export. Everything operationally runs on the router's
own machinery:

- Authoring is a bespoke tree DSL (`route`/`layout`/`router`) compiled to a flat
  `Compiled` structure — HttpApi is a dead _compile target_, never the spine.
- Server render (`server/router-server.ts`) dispatches via a **custom regex matcher**
  (`matcher.ts`) + `renderToStringHydratable`, never `HttpApiBuilder`. 404 is set by
  imperative mutation (`let status` + `onNotFound` callback), not platform error→status.
- No derived `HttpApiClient`. Endpoints are GET-only, `Schema.String` success, no
  payload, no middleware. The path/urlParams bridge is `as any`-cast (no type safety).
- Client nav (`client/router-live.ts`, `client/link.ts`) is functional but missing
  reactive param/query accessors and typed programmatic-nav ergonomics.

**Goal (user-confirmed direction):** keep the tree DSL authoring surface, but make the
platform bridge _real_ — HttpApi becomes the single source of truth for paths + schemas,
the server dispatches through real `HttpApiBuilder`, the client derives a real
`HttpApiClient`, errors map to status via platform, leaf components gain decoded
handler-arg props, and the client gains reactive param/query hooks + typed navigation.

### Confirmed decisions

- **Dispatch:** platform-native on both sides (see _Feasibility constraint_ below).
- **Handler model:** add handler-arg props — leaf `component` receives decoded
  `{ path, query }` as props; **layouts keep DI** (`Router.params`/`query`), since nodes
  deep in the tree can't take handler args. Reactive accessors added on top.
- **Client nav:** add reactive param/query hooks + programmatic-nav ergonomics
  (typed `navigate(ref, args)`, push/replace, back/forward, query patching).

### Feasibility constraint (must be honoured, not papered over)

"Platform both sides" has a hard limit: platform's request→route matching lives in its
**server** (`HttpApiBuilder`/`HttpRouter`); `HttpApiClient.make` issues **real network
requests**, not local URL resolution. There is **no public client-side "match this URL
against my HttpApi locally" utility** in `@effect/platform@0.96.1`.

Therefore "platform both sides" is realised as **single-source-of-truth**, not a literal
platform server in the browser:

- **Server** truly dispatches through `HttpApiBuilder` (platform owns matching + decode).
- **Client** keeps a _local_ matcher (`matcher.ts`) for SPA URL→leaf resolution, but that
  matcher is **fed from the HttpApi endpoint definitions** (path templates + path/query
  schemas) rather than the parallel `Compiled` structure — so both sides agree because
  they read one definition. The client additionally derives a real `HttpApiClient` for
  network work (route prefetch, foundation for future loaders/data).

Verified present in `@effect/platform@0.96.1`: `HttpApiBuilder.{group,api,toWebHandler}`,
`HttpApiClient.make`, `HttpApiError`.

**Platform HTTP reference:** https://github.com/Effect-TS/effect/blob/main/packages/platform/README.md
(raw: https://raw.githubusercontent.com/Effect-TS/effect/main/packages/platform/README.md).
Key facts used by this refactor:

- `handlers.handle(name, fn)` returns the success value (schema-encoded); `handlers.handleRaw(name, fn)`
  returns a full `HttpServerResponse` (own status/headers/body) — use it to emit `text/html` + a 404 status.
- Encode a `Schema.String` success as HTML via `HttpApiSchema.withEncoding({ kind: "Text", contentType: "text/html" })`.
- Catch-all endpoint path is `"*"` (`HttpApiEndpoint.get("catchAll", "*")`); pre-baked `HttpApiError.NotFound` etc. exist.
- `HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive, HttpServer.layerContext))` → `{ handler, dispose }`,
  `handler: (Request) => Promise<Response>`.

---

## Architecture: HttpApi as the spine

Current: `tree → compile() → Compiled → match() (custom, both sides) → outlet render`;
`toHttpApi` is a dead side-export.

Target: `tree → compile() → { httpApi, index }` where

- **`httpApi`** is the authoritative `HttpApi` (one `"pages"` group, one endpoint per
  leaf) carrying each leaf's `setPath`/`setUrlParams` schemas and a 404 `addError`.
- **`index`** is the lightweight nesting/render metadata (layout chain, dedupe prefixes,
  component slots) keyed by endpoint id — the parts platform's flat API can't represent.

`RouterDef` carries both. Server dispatch and client matcher both derive from `httpApi`;
`index` drives only the nested-outlet UI.

---

## Execution model — independent sessions

Each session below is **self-contained and resumable cold**: it states its
preconditions, its changes, and a **green checkpoint** (the package compiles and all
tests pass) so it can be committed and the next session started fresh. Phases are
ordered by dependency; within that order each leaves `main` in a working state. Run
`vp run check && vp run test` at the end of every session before committing.

> Each session updates `router.specs.md` for the slice it touches and adds/adjusts the
> tests named in its checkpoint — spec + tests are part of the session, not a deferred
> phase.

### Phase 1 — HttpApi becomes the owned spine _(foundation; no behaviour change)_

**Preconditions:** none (current `main`).
**Changes:**

- Fold `server/to-http-api.ts` into `compile.ts` (or have `compile` call it) so
  `RouterDef` owns a built `httpApi` plus the existing `Compiled` (rename to `index` if
  clarifying). `makeRouter` stays eager.
- Type leaf path/query schemas string-encodeable so `setPath`/`setUrlParams` drop their
  `as any` casts (param schemas already round-trip strings).
- Add `addError(RouterNotFound → 404)` to each endpoint via `HttpApiError`/`Schema`. Keep
  GET + `Schema.String` success (loaders out of scope per specs §"Boundary.server").
- Keep `patternToId` ids — they are the `HttpApiEndpoint` names and the `httpApi ↔ index`
  join key.
  **Green checkpoint:** nothing consumes `httpApi` yet (server/client unchanged), so all
  existing tests pass unchanged. `to-http-api.test.ts` updated for 404 error + real schemas;
  no `as any` in the bridge. `vp run check` clean (casts gone).

### Phase 2 — server dispatches through `HttpApiBuilder`

**Preconditions:** Phase 1.
**Changes:**

- Rewrite `server/router-server.ts` `render`/`toWebHandler` to dispatch via
  `HttpApiBuilder.group(httpApi, "pages", handlers => …)`: one handler per leaf id,
  receiving platform-decoded `{ path, urlParams }`, building the per-request `Router` from
  those, rendering `RouterApp(def)` to hydratable HTML.
- 404 from a page-raised `RouterNotFound` flows through the endpoint's declared error →
  platform status. Delete the imperative `let status` + `onNotFound` mutation
  (`router-server.ts:60-64`, `RouterAppOptions.onNotFound` in `outlet.ts`).
- Expose `(Request) => Promise<Response>` via `HttpApiBuilder.toWebHandler(layer)`.
  **Green checkpoint:** `router-server.test.ts` rewritten — dispatch via builder, 200/404
  sourced from platform. Client untouched, its tests still pass. `vp run test` green.

### Phase 3 — client matcher fed from HttpApi + derived `HttpApiClient`

**Preconditions:** Phase 1 (Phase 2 not required).
**Changes:**

- `matcher.ts`: `compileMatchers` reads path templates + schemas from the `httpApi`
  endpoints (single source of truth) instead of `Compiled.leaves`; resolve
  `RouteMatch.leaf` to the `index` entry by endpoint id. Keep the regex + memoization
  machinery; only swap the input source. (Matching stays local — see _Feasibility
  constraint_.)
- `client/router-live.ts`: derive `HttpApiClient.make(httpApi)` (configurable `baseUrl`,
  default same-origin), expose on the `Router` service for prefetch / future data. SPA
  resolution still uses the local matcher.
  **Green checkpoint:** `matcher.test.ts` updated (entries from httpApi), href round-trip
  still passes, browser SPA-nav tests still green. `vp run test` + `vp run test:browser`.

### Phase 4 — handler-arg props on leaf components

**Preconditions:** Phase 1 (independent of 2/3).
**Changes:**

- `route-tree.ts`: extend `ComponentSlot`/`SlotNode`/`makeRoute` so a leaf `component` may
  declare typed props `{ path: FieldsType<Path>; query: FieldsType<Query> }`, in addition
  to the existing zero-arg/`Component` forms. `makeLayout` unchanged (DI only).
- `outlet.ts` `renderLevel`: pass decoded `{ path, query }` from the live match into
  `leaf.component({ path, query })`; layouts still get `{}` + DI outlet.
- `router-service.ts`: remove the **double-validate** in `readParams`/`readQuery`
  (currently `Schema.validateEither` on already-decoded values) — read the live match's
  typed values directly. Keep `Router.params`/`query` for layouts/deep nodes.
  **Green checkpoint:** new prop-passing test + updated `__type-tests__/router.test-d.ts`
  (leaf prop inference). DI path still works for layouts. `vp run check` + `vp run test`.

### Phase 5 — client nav utilities

**Preconditions:** Phase 3 (uses the derived client surface + `Router` service shape).
**Changes:**

- Reactive accessors (on `Router` or sibling module): `paramsStream(fields)` /
  `queryStream(fields)` → `Subscribable` derived from `currentMatch.changes`.
- New `client/navigation.ts`: typed `navigate(ref, args)` (via `href` under the hood),
  `push`/`replace` (`history.pushState`/`replaceState`), `back()`/`forward()`
  (`history.go`), `setQuery`/`patchQuery` re-encoding through the leaf's query schema.
  **Green checkpoint:** new `navigation.test.ts` + browser test covering push/replace,
  back/forward, reactive re-render, layout persistence. `__type-tests__` for
  `navigate(ref,args)` inference. `vp run test` + `vp run test:browser`.

### Phase 6 — docs + example _(can run any time after Phase 4/5)_

**Preconditions:** the public surface it documents is merged.
**Changes:** `docs/api/router.md`, `docs/guides/routing.md`; add/refresh a router example
app per the Examples rules in `CLAUDE.md` (co-located `readme.md` + `*.browser.test.ts`)
covering handler-arg props + the new nav surface.
**Green checkpoint:** example builds and its browser test passes; `vp run test:browser`.

> Per-session hygiene: after edits run `graphify update .` to keep the graph current.

---

## Critical files

| File                                             | Change                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `packages/router/src/compile.ts`                 | Own the built `HttpApi` + `index`; type leaf schemas string-encodeable; drop `as any` |
| `packages/router/src/server/to-http-api.ts`      | Folded into compile; add `addError(404)`; remove casts                                |
| `packages/router/src/server/router-server.ts`    | Dispatch via `HttpApiBuilder.group` + `toWebHandler`; status from platform            |
| `packages/router/src/matcher.ts`                 | Source patterns/schemas from `httpApi` endpoints                                      |
| `packages/router/src/route-tree.ts`              | Leaf `ComponentSlot` gains typed `{ path, query }` props                              |
| `packages/router/src/outlet.ts`                  | Pass decoded props to leaf; remove `onNotFound`/status mutation                       |
| `packages/router/src/router-service.ts`          | Drop double-validate; reactive accessors; nav additions                               |
| `packages/router/src/client/router-live.ts`      | Derive `HttpApiClient`; wire nav ergonomics                                           |
| `packages/router/src/client/navigation.ts` (new) | Typed `navigate(ref,args)`/replace/back/forward/query helpers                         |
| `packages/router/src/errors.ts`                  | `RouterNotFound` ↔ HttpApi 404 error mapping                                          |
| `packages/router/router.specs.md`                | Spec the new spine, props, hooks, constraint                                          |

## Reuse (don't rebuild)

- `href()` (`src/href.ts`) — already type-safe URL builder; back `navigate(ref,args)` with it.
- `leafRegistry` (`compile.ts:78`) — keep as the `RouteNode → leaf` stamp for `href`.
- `match()` / `compileMatchers` memoization (`matcher.ts`) — keep the regex + dedupe
  machinery; only change its _input source_ to the HttpApi endpoints.
- `RouterApp` / `outletNode` boundary plumbing (`outlet.ts`) — keep; only the status side-channel changes.
- `Subscribable`/`SubscriptionRef` reactive pattern already in `router-live.ts` — reuse for the new hooks.

## Note on "eager build"

Eager compilation is **not** a real divergence — `@effect/platform` endpoint composition
is eager too. `makeRouter` staying eager is correct and stays. No change needed there;
the docs wording ("eagerly builds") can be clarified but it is not a defect.

---

## Verification

- `vp run check` — format, lint, typecheck (packs first). Must pass with the new
  string-encodeable schema types and removed `as any` casts.
- `vp run test` — node/jsdom: matcher-from-httpApi, server dispatch + 404-from-platform,
  href round-trip, new navigation helpers, reactive hooks.
- `vp run test:browser` — real-browser SPA nav: link interception, push/replace,
  back/forward, reactive param/query re-render, layout persistence across nav.
- End-to-end smoke: build the router example app, `vp dev`, exercise an SSR initial load
  (status 200 + 404 path served through `HttpApiBuilder`) then client navigation; confirm
  the derived `HttpApiClient` can fetch a route's HTML same-origin.
