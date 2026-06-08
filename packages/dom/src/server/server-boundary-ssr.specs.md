# Boundary.rpc — SSR Emit Specification

## Overview

`Boundary.rpc` is constructed with `Boundary.rpc(rpc, payload, render, options?)`
(in `@effect-ui/core`) and recognised by the server renderer via its
`SERVER_BOUNDARY` symbol type tag. This spec covers the **server emit** half of the
renderer contract stated in `packages/core/src/boundary/boundary-rpc.specs.md`
(AC-10 … AC-12, AC-15). The client `hydrate` replay and client-first mount halves
are spec'd alongside the DOM client package.

The boundary's data source is the ambient `AppRpcClientTag` seam, not a co-located
`load`. On the server `@effect-ui/router` provides an **in-process** client over
the rpc handler Layer; SSR therefore requires an `AppRpcClientTag` in context (the
`renderTo*` signatures carry it as a requirement). When `renderToStream` /
`renderToString` (plain passes) or `renderToStreamHydratable` /
`renderToStringHydratable` (hydratable passes) reach a `Boundary.rpc` descriptor,
the renderer:

1. Calls `AppRpcClient.call(tag, payload())`, **blocking** on it (like the first
   emission of a `List.each` source). The call returns the already-decoded success.
2. Renders `render(resource)` to HTML in place via the same recursive render
   function, where `resource` is a **static-seeded** `Resource<A>` (`value` is a
   `Subscribable` over the resolved `data` that emits once; `pending` is `false`,
   `error` is `None`, `refetch` is a no-op). Because `value` emits the seed
   synchronously the SSR HTML is byte-identical to a bare `render(data)`.
3. **Hydratable passes only:** emits the `Schema.encode`d (via the rpc's
   `successSchema`), `JSON.stringify`d `data` inline as a
   `<script type="application/json">…</script>` **before** the `render(data)` HTML,
   XSS-escaped. The plain passes emit **no** payload script.

No wrapper comment markers bracket the region: `render(data)` is fully-resolved
static HTML located positionally, and the payload script itself sits at the region
cursor for the client `hydrate` walk to read.

### Scope

Success path **and typed-failure encoding**. A resolved rpc **error** is encoded
(via the rpc's `errorSchema`) for client replay by the enclosing failure
`Boundary` (see AC-7 … AC-9 below). A transport **defect** (no `Cause.failureOption`,
or an rpc with no `error` schema) is server-side only — it propagates as a stream
failure with no payload.

### Encode-in-catch

The failure payload is emitted by the **catch handler** of the enclosing failure
boundary, never inside the discarded children buffer. The failing `Boundary.rpc`
only `Schema.encode`s its resolved error (via `errorSchema`) and stashes
`{ owner, encoded }` in a pass-local collector, then re-fails the **original**
cause so `match` still sees it unchanged. The enclosing failure boundary drains the
collector and emits the payload before the fallback HTML.

---

## Acceptance Criteria

### AC-1: Hydratable pass emits a decodable inline payload (core AC-10)

- **Given** a `Boundary.rpc(rpc, payload, render)` node and an `AppRpcClientTag`
  whose `call` resolves the rpc
- **When** rendered via `renderToStringHydratable` / `renderToStreamHydratable`
- **Then** a `<script type="application/json">…</script>` element appears at the
  region cursor, **before** the `render(data)` HTML, whose text content is valid
  JSON that, after `JSON.parse` → `Schema.decode(successSchema)`, equals the
  resolved `data`.

### AC-2: `render(resource)` HTML is rendered in place (core AC-12)

- **Given** the node above
- **When** rendered via any pass (plain or hydratable)
- **Then** the serialized HTML of `render(resource)` appears in the output,
  complete and usable without JS, where `resource` is a static-seeded `Resource<A>`
  whose `value` emits the resolved `data` synchronously. Byte-identical to a bare
  `render(data)`.

### AC-3: Plain passes emit no payload script (core AC-11)

- **Given** the node above
- **When** rendered via `renderToString` or `renderToStream` (plain)
- **Then** the output contains the `render(data)` HTML but **no**
  `<script type="application/json">` payload.

### AC-4: Blocking resolve through the ambient client

- **Given** an `AppRpcClientTag` in context
- **When** rendered
- **Then** the renderer calls `AppRpcClient.call(tag, payload())`, blocks for the
  result, and uses it for both the payload and `render(data)`. The requirement is
  the `AppRpcClientTag` seam only — no per-boundary `provide`/`RServer`.

### AC-5: Positional nesting (core edge cases)

- **Given** a `Boundary.rpc` whose `render` contains another `Boundary.rpc`
- **When** rendered via a hydratable pass
- **Then** each boundary emits its own payload positionally within its own region,
  and each payload independently decodes to its data.

### AC-5b: Same tag, different payload

- **Given** two `Boundary.rpc` using the same rpc `tag` with different `payload()`
- **When** rendered
- **Then** each resolves independently from its own payload (the payload is a typed
  input, not a per-entity id).

### AC-6: XSS-safe payload escaping

- **Given** resolved `data` whose encoded JSON contains `<`, `>`, `&`, or the JS
  line/paragraph separators U+2028/U+2029
- **When** emitted in a hydratable pass
- **Then** those characters are emitted as `\uXXXX` escapes (so an embedded
  `</script` cannot close the script early), and the payload still round-trips.

### AC-7: Typed-failure encoding (hydratable, core AC-15)

- **Given** a `Boundary.rpc` whose rpc declares an `error` schema and whose `call`
  resolves to a typed error, nested inside a failure `Boundary` whose `match`
  handles the cause
- **When** rendered via a hydratable pass
- **Then** the enclosing failure boundary emits, **before** its fallback HTML, a
  single `<script type="application/json" data-eui-boundary-failure>` whose JSON is
  `{ index, error }`: `index` is the failing boundary's pre-order position among the
  `SERVER_BOUNDARY` descriptors statically reachable in the failure boundary's
  `children`, and `error` is the `Schema.encode`d (via the rpc's `errorSchema`),
  XSS-escaped error. The original cause still reaches `match` unchanged.

### AC-8: Plain passes emit no failure payload

- **Given** the node above rendered via `renderToString` / `renderToStream`
- **Then** the fallback HTML is emitted with **no** `data-eui-boundary-failure`
  script (unchanged no-JS behaviour).

### AC-9: Relocation and non-replayed cases

- **`match` returns `null`:** the cause re-fails **without** draining the
  collector, so the payload relocates to the next enclosing failure boundary
  (its `index` recomputed against that boundary's `children`).
- **No enclosing failure boundary:** the render fails — nothing to relocate to.
- **Defect (`Die`) / no error schema:** no `Cause.failureOption` (or the encode
  would be `Never`), so nothing is stashed and no failure payload is emitted; it
  propagates as a server-side failure.
- **Encode failure:** if `Schema.encode(successSchema)(data)` fails (resolved data
  violates the wire contract), the hydratable render fails rather than emitting a
  corrupt payload.
