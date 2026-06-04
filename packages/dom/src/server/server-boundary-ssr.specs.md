# Boundary.server — SSR Emit Specification

## Overview

`Boundary.server` is constructed with `Boundary.server(props, render)` (in
`@effect-ui/core`) and recognised by the server renderer via its
`SERVER_BOUNDARY` symbol type tag. This spec covers the **server emit** half of
the renderer contract stated in `packages/core/src/boundary/server.specs.md`
(AC-10 … AC-12, AC-14). The client `hydrate` replay half is spec'd alongside the
DOM client package.

When `renderToStream` / `renderToString` (plain passes) or
`renderToStreamHydratable` / `renderToStringHydratable` (hydratable passes) reach
a `Boundary.server` descriptor, the renderer:

1. Runs `Effect.provide(load(), provide)` to obtain `data: A`, **blocking** on it
   (like the first emission of a `List.each` source). `provide` discharges
   `load`'s server-only requirements, so SSR assumes no further `R`.
2. Renders `render(data)` to HTML in place via the same recursive render
   function, so any nested reactive regions inside it get their normal markers.
3. **Hydratable passes only:** emits the `Schema.encode`d, `JSON.stringify`d
   `data` inline as a `<script type="application/json">…</script>` **before** the
   `render(data)` HTML, XSS-escaped (see escaping below). The plain passes emit
   **no** payload script.

No wrapper comment markers bracket the region: `render(data)` is fully-resolved
static HTML located positionally, and the payload script itself sits at the
region cursor for the client `hydrate` walk to read.

### Scope

Success path (v1) **and typed-failure encoding (v2)**. A successful `load` emits
the success payload described above. A typed `load` **failure** is encoded for
client replay by the enclosing failure `Boundary` (see AC-7 … AC-9 below). A
`load` **defect** (not an expected `ELoad`) is still server-side only — it
propagates as a stream failure with no payload.

### Blocker resolution — encode-in-catch

The previously-documented blocker (the enclosing `renderBoundarySSR` buffers
children via `Stream.mkString` and **discards** that HTML on a propagating cause,
which would discard a payload emitted inside the region) is dissolved by emitting
the failure payload from the **catch handler**, never inside the discarded
children buffer. The failing `Boundary.server` only `Schema.encode`s its error and
stashes `{ owner, encoded }` in a pass-local collector (threaded through the SSR
render context alongside the suspense context), then re-fails the **original**
cause. The enclosing failure boundary — which already holds the cause and renders
the fallback — drains the collector and emits the payload before the fallback HTML.
Nothing is emitted inside the discarded region.

---

## Acceptance Criteria

### AC-1: Hydratable pass emits a decodable inline payload (core AC-10)

- **Given** a `Boundary.server({ load, provide, schema }, render)` node
- **When** rendered via `renderToStringHydratable` / `renderToStreamHydratable`
- **Then**:
  - A `<script type="application/json">…</script>` element appears at the region
    cursor, **before** the `render(data)` HTML.
  - Its text content is valid JSON that, after `JSON.parse` → `Schema.decode`,
    equals the `data` produced by `load`.

### AC-2: `render(data)` HTML is rendered in place (core AC-12)

- **Given** the node above
- **When** rendered via any pass (plain or hydratable)
- **Then** the serialized HTML of `render(data)` appears in the output, complete
  and usable without JS.

### AC-3: Plain passes emit no payload script (core AC-11)

- **Given** the node above
- **When** rendered via `renderToString` or `renderToStream` (plain)
- **Then** the output contains the `render(data)` HTML but **no**
  `<script type="application/json">` payload.

### AC-4: Blocking load with `provide`

- **Given** a `load` whose effect requires a server-only service supplied by
  `provide`
- **When** rendered
- **Then** the renderer runs `Effect.provide(load(), provide)`, blocks for the
  result, and uses it for both the payload and `render(data)` — no requirement
  escapes into the render.

### AC-5: Positional nesting (core AC-14 + edge cases)

- **Given** a `Boundary.server` whose `render` contains another `Boundary.server`
- **When** rendered via a hydratable pass
- **Then** each boundary emits its own payload positionally within its own
  region (outer payload before the outer subtree; inner payload inside it,
  before the inner subtree), and each payload independently decodes to its data.

### AC-6: XSS-safe payload escaping

- **Given** loaded `data` whose encoded JSON contains `<`, `>`, `&`, or the JS
  line/paragraph separators U+2028/U+2029
- **When** emitted in a hydratable pass
- **Then** those characters are emitted as `\uXXXX` escapes (so an embedded
  `</script` cannot close the script early), and the payload still `JSON.parse`s
  and `Schema.decode`s back to the original `data`.

### AC-7: Typed-failure encoding (hydratable, core AC-15)

- **Given** a `Boundary.server({ load, provide, schema, failure }, render)` whose
  `load` fails with a typed `ELoad`, nested inside a failure `Boundary` whose
  `match` handles the cause
- **When** rendered via a hydratable pass
- **Then** the enclosing failure boundary emits, **before** its fallback HTML, a
  single `<script type="application/json" data-eui-boundary-failure>` whose JSON is
  `{ index, error }`: `index` is the failing boundary's pre-order position among
  the `SERVER_BOUNDARY` descriptors statically reachable in the failure boundary's
  `children`, and `error` is the `Schema.encode`d (via `failure`), XSS-escaped
  `ELoad`. The original cause still reaches `match` unchanged (so the fallback DOM
  is exactly the no-JS fallback).

### AC-8: Plain passes emit no failure payload

- **Given** the node above rendered via `renderToString` / `renderToStream`
- **Then** the fallback HTML is emitted with **no** `data-eui-boundary-failure`
  script (unchanged no-JS behaviour).

### AC-9: Relocation and non-replayed cases

- **`match` returns `null`:** the cause re-fails **without** draining the
  collector, so the payload relocates to the next enclosing failure boundary that
  handles it (its `index` recomputed against that boundary's `children`).
- **No enclosing failure boundary:** the render fails (nothing to relocate to) —
  unchanged from v1.
- **Defect (`Die`):** no `Cause.failureOption`, so nothing is stashed and no
  failure payload is emitted; the defect propagates as in v1.
- **Missing `failure` schema or a failing encode:** nothing is stashed; the cause
  propagates to the fallback with no payload (degrades to v1 / client mismatch).
