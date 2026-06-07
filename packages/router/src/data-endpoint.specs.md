# Router Data Endpoint — Boundary Refetch Specification

## Overview

The data endpoint is the **server transport** for endpoint-backed
`Boundary.server` client refetch (see
`packages/core/src/boundary/server.specs.md`, AC-17 … AC-19). A
`Boundary.server` is a one-shot SSR snapshot at first paint; after hydration the
client can `refetch` its data. Refetch is endpoint-backed: it never runs `load` on
the client. Instead the router exposes a same-origin endpoint that re-runs the
registered `load` **on the server** and returns the `schema`-encoded result, which
the client decodes and pushes into the boundary's reactive `Resource<A>`.

This reuses the router's existing single-source HttpApi spine (`RouterDef.httpApi`):
the data endpoint lives on the same `def.httpApi` the client `HttpApiClient` is
derived from (`client/router-live.ts`), so server dispatch and client call agree by
construction — exactly like the `"pages"` group.

### Why a generic data group (not per-route loaders)

The HttpApi spine is **static** (built once from route leaves at `makeRouter`
time). `Boundary.server` nodes are anonymous, created intra-render, and a single
page may contain several. So instead of coupling data to route leaves, the router
adds **one generic parametrized endpoint** keyed by the boundary's `id`, backed by
the core module-level registry (`@effect-ui/core`'s `~/boundary/registry`).

---

## Acceptance Criteria

### AC-D1: The `_eui_data` group is on the spine

- **Given** a compiled `RouterDef`
- **Then** `def.httpApi` contains a group `"_eui_data"` with a single endpoint
  `boundaryData`: `GET /_eui/data` with
  `urlParams: Schema.Struct({ id: Schema.String, params: Schema.optional(Schema.String) })`,
  success `Schema.String` (an opaque JSON envelope), and error
  `BoundaryDataNotFound` mapped to HTTP 404.
- The existing `"pages"` group is **unchanged** (same endpoints, same
  `setSuccess(Schema.String)` HTML contract). The matcher
  (`matcher.ts`) continues to read only the `"pages"` group.

### AC-D2: Handler re-runs the registered loader server-side

- **Given** a request `GET /_eui/data?id=<id>&params=<json>` where `<id>` is a
  registered boundary
- **When** the server handles it
- **Then** it looks up `<id>` in the core registry, runs
  `Effect.provide(load(), provide)` on the server, `Schema.encode`s the result via
  the boundary's `schema`, and returns it as the (string) envelope with HTTP 200.
  `params` (if present) is `JSON.parse`d and made available to `load` as its input
  (route params/query the loader keyed on).

### AC-D3: Unknown id ⇒ 404

- **Given** a request whose `id` is not in the registry
- **Then** the handler fails with `BoundaryDataNotFound` (HTTP 404), not a defect.

### AC-D4: Server-only secrecy preserved

- **Given** any data-endpoint request
- **Then** `load`, `provide`, and `RServer` are discharged/run entirely on the
  server; the response body carries only the `schema`-encoded `A`. The client never
  receives the loader closure or any server-only service. (`AssertNoServerOnly`
  remains satisfied because the client calls a string-returning endpoint, never
  `load`.)

### AC-D5: Client derivation unchanged in shape

- **Given** the client-derived `HttpApiClient` (`client/router-live.ts`)
- **Then** it exposes the `_eui_data.boundaryData` call alongside the `pages`
  calls, callable as
  `client._eui_data.boundaryData({ urlParams: { id, params } })`. The opaque
  `RouterHttpApiClient` type (`router-service.ts`) is unchanged (success stays
  `Schema.String`).

### AC-D6: Envelope contract mirrors the inline SSR payload

- **Given** a boundary whose SSR inline payload encodes `data` via `schema`
- **Then** the data-endpoint envelope encodes the **same** `data` via the **same**
  `schema`, so the client decode path is identical to the hydrate decode path
  (`JSON.parse` → `Schema.decode(schema)`). One `schema` definition serves SSR
  replay and refetch.

### Edge cases

- **Registry miss across processes:** registration happens at descriptor-build
  time from the module graph, so any server instance that loaded the route module
  graph can serve any `id` — independent of which instance did the original SSR.
- **Malformed `params`:** a `params` value that is not valid JSON (or fails the
  loader's own decode) surfaces as the loader's typed failure / a 4xx, not a defect.
- **Server context (`httpApiClient = none`):** the data endpoint is served by the
  server; the server's own `Router.httpApiClient` stays `Option.none()` (it is the
  origin). Only the client derives and calls the endpoint.

---

## API shape

```ts
// router errors
class BoundaryDataNotFound extends Schema.TaggedError<BoundaryDataNotFound>()(
  "BoundaryDataNotFound",
  { id: Schema.String },
) {}

// on def.httpApi (built in compile.ts buildHttpApi)
HttpApiGroup.make("_eui_data").add(
  HttpApiEndpoint.get("boundaryData", "/_eui/data")
    .setUrlParams(Schema.Struct({ id: Schema.String, params: Schema.optional(Schema.String) }))
    .addSuccess(Schema.String)
    .addError(BoundaryDataNotFound, { status: 404 }),
);

// client call (client/router-live.ts derived client)
client._eui_data.boundaryData({ urlParams: { id, params } }); // => Effect<string, …>
```
