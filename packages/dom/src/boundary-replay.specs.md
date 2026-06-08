# Boundary replay — Shared Traversal Spec

## Overview

`boundary-replay.ts` is the single module shared by the **server SSR** and the
**client `hydrate`** so that a failing `Boundary.rpc`'s position is computed
identically on both sides. It owns:

- `BOUNDARY_FAILURE_ATTR` — the marker attribute (`data-weft-boundary-failure`) on
  the inline failure-payload `<script type="application/json">`, distinguishing it
  from a success payload (the same `<script>` with no attribute).
- `collectServerBoundaries(children)` — the one pre-order traversal over the
  `SERVER_BOUNDARY` descriptors statically reachable in a failure boundary's
  `children`, returning their live descriptor `props` in document order.

The index a failure boundary writes (server) and reads (client) is
`collectServerBoundaries(children).indexOf(owner)` / `[index]` — the only extra
field on the wire beyond the encoded error.

## Why a shared module

The server computes the failing boundary's index inside the enclosing failure
boundary's catch handler; the client looks up the same index to find the
boundary's `failure` schema. If the two walks diverged, the client would decode
against the wrong schema. Sharing one traversal guarantees they agree — the same
positional determinism hydration already relies on for suspense / `List.each`.

## Acceptance Criteria

### AC-BR1: Pre-order, document order

- **Given** a `children` tree containing multiple `Boundary.rpc` descriptors
- **When** `collectServerBoundaries(children)` runs
- **Then** it returns their `props` in pre-order (depth-first, document order),
  so `[0]` is the first `Boundary.rpc` encountered, `[1]` the next, etc.

### AC-BR2: Reference identity

- **Given** a `Boundary.rpc` descriptor reachable in `children`
- **When** collected
- **Then** the returned element is the **same object** as the descriptor's live
  `props` (so the server can `indexOf(owner)` by reference identity).

### AC-BR3: Descends static container nodes

- **Then** the traversal descends arrays/iterables, `FRAGMENT`,
  `SUSPENSE_BOUNDARY`, `FAILURE_BOUNDARY`, string-element children, static-markup
  nodes carrying an `ElementDescriptor`, and **function components** (called with
  their props, exactly as the renderers call them).

### AC-BR4: Does not descend data-dependent regions

- **Then** the traversal does **not** descend into another `Boundary.rpc`'s
  `render(data)` output, a `List.each` projection, or a genuinely reactive
  `Effect`/`Stream` child with no static descriptor. A `Boundary.rpc`
  reachable only through one of these is **not** indexed (its failure degrades to
  a recoverable hydration mismatch, like a missing payload).

### AC-BR5: Symmetry

- **Given** the identical `children` tree on server and client
- **When** `collectServerBoundaries` runs on each
- **Then** the returned sequences are positionally identical (same length, same
  order), so an index written by the server resolves to the same boundary on the
  client.

## Constraint

A `Boundary.rpc` whose typed rpc failure should be replayed on the client
**must be statically reachable** within the enclosing failure boundary's
`children` per AC-BR3/AC-BR4. This mirrors the determinism every other positional
adopt-walk already requires.
