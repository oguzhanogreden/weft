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

1. **Does not run `load`.** It replays the server result — never retries `load`.
2. Reads the payload's text content, `JSON.parse` → `Schema.decode` → `data`.
3. **Seeds a live `Resource<A>`** with `data`: a `SubscriptionRef` holding the
   decoded value, exposed as `resource.value` (await-first, emits the seed first),
   plus `refetch`/`pending`/`error`. `refetch` reads `Router.httpApiClient` and
   calls the data endpoint for this boundary's `id`, decodes the envelope via
   `schema`, and `SubscriptionRef.set`s `value`.
4. Hydrates `render(resource)` against the adopted DOM starting at
   `script.nextSibling`, wiring event handlers and reactive subscriptions in
   place (node identity preserved, no re-render). `resource.value` renders through
   the renderer's existing reactive-child path; its first emission is the seeded
   `data`, so the adopt-walk matches the server DOM (no fallback flash).
5. Removes the payload script (it is consumed only by hydration) and returns the
   cursor following `render(resource)`, so the surrounding adopt-walk stays aligned.
   The region stays **live** afterwards — a later `refetch` patches it in place.

Region location is **positional**: the payload sits at the region cursor and is
read inline during the same depth-first walk the renderer already relies on — no
service, no markers, no entrypoint plumbing.

### Scope

Success replay is owned here (`hydrateServerBoundary`). A payload that is
missing, malformed, or fails `schema` decoding is treated as a **recoverable**
hydration mismatch (`HydrationMismatchError`, logged) — not a defect — since the
region cannot be located or replayed without the data.

**Typed-failure replay is owned by the enclosing failure `Boundary`, not here.**
On a `load` failure the server renders the failure boundary's _fallback_ (a tree
independent of this boundary's `render(data)`), so a children-vs-fallback walk
diverges structurally _before_ reaching this server boundary — its hydrate is
unreachable on a failure. The failure boundary therefore detects the
`data-eui-boundary-failure` payload, decodes via this boundary's `failure` schema
(located by pre-order index), rebuilds the cause, and hydrates the fallback. See
`client/boundary.specs.md`. The only obligation here is **defensive** (AC-H-S7):
the success path must reject a failure-marked payload rather than mis-decode it.

### AC-H-S7: Success path rejects a failure payload (defensive)

- **Given** the cursor at a `<script type="application/json" data-eui-boundary-failure>`
  (a failure payload that somehow reached the server-boundary success descent)
- **When** `hydrateServerBoundary` runs
- **Then** it fails with a `HydrationMismatchError` rather than decoding the
  failure payload as success `data`.

---

## Acceptance Criteria

### AC-H-S1: Replay decodes the inline payload + seeds a live resource (core AC-13, AC-17)

- **Given** server HTML containing a `Boundary.server` region (payload script +
  `render(resource)` HTML)
- **When** `hydrate` reaches the region
- **Then** it `JSON.parse` → `Schema.decode`s the payload to `data`, seeds a live
  `Resource<A>` (`value` emitting `data` first), and hydrates `render(resource)`
  against the adopted DOM, preserving node identity (the server-rendered nodes are
  adopted in place, not re-created). No fallback flash: the seeded `value`'s first
  emission equals the server `data`.

### AC-H-S8: Refetch patches the region in place (core AC-17, AC-19)

- **Given** a hydrated `Boundary.server` region and a mounted router data endpoint
- **When** `resource.refetch` runs
- **Then** it calls `GET /_eui/data?id=<id>&params=…` via `Router.httpApiClient`,
  `Schema.decode`s the envelope via `schema`, and `SubscriptionRef.set`s `value` —
  so `render`'s subtree patches in place (no remount). `pending` is `true` during
  the call and `false` after. `load` is **not** run on the client.

### AC-H-S9: Refetch failure is stale-on-error

- **Given** a hydrated region whose refetch endpoint call fails (network/4xx/decode)
- **When** `resource.refetch` runs
- **Then** the previous `value` is retained (subtree unchanged), `error` becomes
  `Some(cause)`, `pending` returns to `false`, and the failure is **not** raised
  into an enclosing failure `Boundary` (no fallback flash). A subsequent successful
  refetch clears `error` to `None`.

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
