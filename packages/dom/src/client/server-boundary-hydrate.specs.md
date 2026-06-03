# Boundary.server — Hydrate Replay Specification

## Overview

`Boundary.server` is constructed with `Boundary.server(props, render)` (in
`@effect-ui/core`) and recognised by the DOM client renderer via its
`SERVER_BOUNDARY` symbol type tag. This spec covers the **client `hydrate`
replay** half of the renderer contract stated in
`packages/core/src/boundary/server.specs.md` (core AC-13, AC-14). The server
emit half is spec'd in `packages/dom/src/server/server-boundary-ssr.specs.md`.

When the `hydrate` adopt-walk reaches a `SERVER_BOUNDARY` descriptor, the cursor
is positioned on the inline `<script type="application/json">…</script>` payload
the hydratable server renderer emitted at the region cursor (followed by the
`render(data)` HTML). The client renderer:

1. **Does not run `load`.** It replays the server result — never retries.
2. Reads the payload's text content, `JSON.parse` → `Schema.decode` → `data`.
3. Hydrates `render(data)` against the adopted DOM starting at
   `script.nextSibling`, wiring event handlers and reactive subscriptions in
   place (node identity preserved, no re-render).
4. Removes the payload script (it is consumed only by hydration) and returns the
   cursor following `render(data)`, so the surrounding adopt-walk stays aligned.

Region location is **positional**: the payload sits at the region cursor and is
read inline during the same depth-first walk the renderer already relies on — no
service, no markers, no entrypoint plumbing.

### v1 scope

Success path only. A payload that is missing, malformed, or fails `schema`
decoding is treated as a **recoverable** hydration mismatch
(`HydrationMismatchError`, logged) — not a defect — since the region cannot be
located or replayed without the data. Typed-failure replay (re-raising a server
`load` failure on the client) is a deferred phase.

---

## Acceptance Criteria

### AC-H-S1: Replay decodes the inline payload (core AC-13)

- **Given** server HTML containing a `Boundary.server` region (payload script +
  `render(data)` HTML)
- **When** `hydrate` reaches the region
- **Then** it `JSON.parse` → `Schema.decode`s the payload to `data` and hydrates
  `render(data)` against the adopted DOM, preserving node identity (the
  server-rendered nodes are adopted in place, not re-created).

### AC-H-S2: `load` is never run on the client

- **Given** a `Boundary.server` whose `load` reads a server-only service
- **When** the region is hydrated
- **Then** `load` is **not** invoked on the client — the serialized result is
  replayed. (The boundary's server-only requirement therefore never reaches the
  client; a leak is rejected at the type level — see AC-H-S6.)

### AC-H-S3: Post-hydrate interactivity

- **Given** a `render(data)` subtree containing an event handler / reactive prop
- **When** the region is hydrated
- **Then** the handler/subscription is wired against the adopted DOM and fires
  after hydration.

### AC-H-S4: Cursor alignment (core AC-14)

- **Given** a `Boundary.server` followed by sibling nodes, and nested
  `Boundary.server` regions
- **When** hydrated
- **Then** the cursor is stepped past the payload script and the full
  `render(data)` output, so following siblings and nested boundaries hydrate
  positionally, and every payload script is consumed (removed from the DOM).

### AC-H-S5: Payload divergence is a recoverable mismatch

- **Given** a region whose cursor is **not** the expected
  `<script type="application/json">` payload, or whose payload is malformed JSON,
  or whose payload fails `schema` decoding
- **When** hydrated
- **Then** `hydrate` fails with a `HydrationMismatchError` (a typed, recoverable
  failure, logged), not a defect.

### AC-H-S6: A leaked server-only Tag is a compile error (core AC-7/AC-9)

- **Given** an app node whose requirement channel `R` retains a server-only
  `ServerTag` (e.g. referenced in client `render` code, not discharged by
  `provide`)
- **When** passed to `hydrate`
- **Then** it is a compile error: `hydrate`'s return type degrades to the
  `ServerOnlyLeak` sentinel via `AssertNoServerOnly<R>`. Clean nodes (including
  plain client requirements and raw `Renderable` inputs) hydrate normally. Pinned
  by `src/client/__type-tests__/hydrate.test-d.ts`.
