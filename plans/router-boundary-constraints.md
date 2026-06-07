# Router + Boundary.server constraints (future work)

Two framework limitations surfaced while building the `examples/router-ssr`
e-commerce example (path param + query param + `Boundary.server` refetch). Both are
**worked around** in the example today; this doc captures them as future work so the
underlying behaviour can be improved in a later session.

---

## Constraint 1 — Client-first SPA mount of a `Boundary.server` is unsupported

### Symptom

SPA-navigating _into_ a route whose page contains a `Boundary.server` crashes:

```
UnsupportedNodeTypeError: Invalid Renderable type: expected string, FRAGMENT,
or function, got symbol
```

The `symbol` is the `SERVER_BOUNDARY` descriptor tag falling through to the plain
`renderNode` path.

### Root cause

The client **mount** render path handles `SUSPENSE_BOUNDARY` and `FAILURE_BOUNDARY`
but **not** `SERVER_BOUNDARY`:

- `packages/dom/src/client/render.ts:722` — `if (type === SUSPENSE_BOUNDARY)` (mount)
- `packages/dom/src/client/render.ts:727` — `if (type === FAILURE_BOUNDARY)` (mount)
- `packages/dom/src/client/render.ts:1975` — `if (type === SERVER_BOUNDARY)` — only
  in the **hydrate** path (`hydrateReactive`), not the mount path.

So a `Boundary.server` only works when it is **hydrated** (its SSR `<script
type="application/json">` payload is present). On a client-first mount there is no
payload and the client cannot run `load` (server-only) — the region has no data.

This is consistent with the spec, which lists it as out of scope:

- `packages/core/src/boundary/server.specs.md` — "**Client-first mount** of a
  `Boundary.server` with no SSR payload is out of scope for this phase: refetch is
  only available after an SSR hydrate seeds the resource; reach for
  `Boundary.suspend` for client-first data."
- `packages/router/router.specs.md` — same v1 scope note.

### Current workaround (in the example)

`examples/router-ssr/src/components/product-card.ts` — the `View` links carry
`rel="external"`, so clicking one does a **full navigation** (the link interceptor
at `packages/router/src/client/link.ts:47` skips `rel="external"`). The server
renders the detail page (running `load`) and the client hydrates it — the supported
entry. After hydrate, `resource.refetch` works (SPA, in place).

`examples/router-ssr/src/app.browser.test.ts` therefore only SPA-navigates between
boundary-free pages; the detail page's SSR + hydrate + refetch is covered by
`refetch.browser.test.ts` (which hydrates `/products/:id`).

### Possible direction (to design later)

Make the client **mount** path handle `SERVER_BOUNDARY` so SPA navigation into a
`Boundary.server` page works without a full load. Options to weigh:

1. **Fetch-on-mount via the data endpoint.** On a client-first mount, treat the
   boundary like a first refetch: call `GET /_eui/data?id=<id>` to get the encoded
   `A`, render a pending/fallback state until it resolves, then seed the resource.
   Needs: a render-time fallback contract (mirror `Boundary.suspend`'s `fallback`),
   and the per-`id` registration already done at descriptor-build
   (`packages/core/src/boundary/index.ts:398`) to be reachable for the _target_
   page's boundaries (see Constraint 2 — these interact).
2. **Document `Boundary.suspend` as the client-first path** and keep
   `Boundary.server` hydrate-only, but add a _typed_ guard so a SPA-reachable
   `Boundary.server` is a compile-time or dev-time error instead of a runtime
   `UnsupportedNodeTypeError`.

Touch points: `packages/dom/src/client/render.ts` (mount branch near 722),
`packages/core/src/boundary/index.ts`, `packages/router/src/client/router-live.ts`
(the derived `HttpApiClient` transport already exists for refetch).

---

## Constraint 2 — Refetch carries only `id`, never route params

### Symptom

A `Boundary.server` `load` cannot receive route params (e.g. a product `:id`) at
**refetch** time, so per-entity live data must be keyed entirely by the boundary
`id`.

### Root cause

The client refetch sends only the boundary `id`:

- `packages/dom/src/client/render.ts:2319` — `dataClient.fetch({ id })` (no `params`).
- `packages/core/src/boundary/data-client.ts:21-28` — the transport request _type_
  has an optional `params?: string`, but nothing populates it.
- The endpoint _is_ defined to accept it: `packages/router/src/data-endpoint.specs.md`
  AC-D2 — "`params` (if present) is `JSON.parse`d and made available to `load` as its
  input (route params/query the loader keyed on)." So the server side is ready; the
  **client** side never sends `params` and the public `load: () => Effect`
  (`packages/core/src/boundary/index.ts` `ServerProps`) takes **no argument**.

### Current workaround (in the example)

`examples/router-ssr/src/pages/product-detail.ts` — each product gets its own
boundary `id` (`` `stock-${product.id}` ``) and `load` closes over `product.id`.
Registration happens at descriptor-build during render
(`packages/core/src/boundary/index.ts:398`), so the in-process dev server / test
handler always has the visited product's loader before a refetch.

Caveat (noted in the example readme): a cold server process that never rendered that
product would `404` the refetch, because the closure was never registered there.

### Possible direction (to design later)

Let a `Boundary.server` declare a **param input** that is sent on refetch:

1. Extend `ServerProps` so `load` can take a typed input (e.g.
   `params: () => Input` + `load: (input: Input) => Effect<…>`, with an `Input`
   wire schema), or carry the current route `path`/`query` automatically.
2. Populate the request `params` in the refetch builder
   (`packages/dom/src/client/render.ts` ~2313-2334) by encoding that input to JSON.
3. Server handler already decodes `params` and feeds `load` (AC-D2). This makes the
   boundary `id` **stable** (one `id` per boundary, not per entity) and removes the
   cold-process `404` caveat — any server instance that loaded the module graph can
   serve any entity by `id` + `params`.

Touch points: `packages/core/src/boundary/index.ts` (`ServerProps`, `server`
signature, registry entry), `packages/dom/src/client/render.ts` (refetch builder),
`packages/core/src/boundary/data-client.ts`, `packages/router/src/data-endpoint.ts`
(already handles `params`).

> The two constraints interact: a clean client-first mount (Constraint 1, option 1)
> for a param-keyed page needs the param-carrying refetch (Constraint 2) so the
> mount fetch can ask for the _right_ entity.
