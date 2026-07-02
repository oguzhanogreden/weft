# Streaming shell — Specification

## Overview

This spec defines two server-renderer features that let an HTTP-facing consumer
(concretely: `@weftui/router`'s `RouterServer.toStreamingWebHandler`, spec'd in
`packages/router/router.specs.md`) stream Suspense patches while still deciding
the HTTP status code _before_ any bytes are flushed:

1. **`renderToHydratableShell`** — a shell-split variant of
   `renderToStreamHydratable` that separates the buffered main document walk
   (the "shell") from the trailing Suspense patch stream.
2. **`SuspenseFailureHandlerTag`** — an ambient, optional service seam that lets
   a consumer turn an otherwise-swallowed Suspense resolution failure into a
   patch (e.g. the router's not-found UI plus a `noindex` robots meta tag).

### Why: the status-after-bytes problem

HTTP status and headers must be sent before the first body byte. Today's
combined-stream variants (`renderToStream` / `renderToStreamHydratable`) start
emitting immediately, so a consumer cannot render-then-decide (e.g. return a
real **404** when `RouterNotFound` is raised during the walk) without buffering
the whole stream — which defeats streaming.

The existing stream structure already makes a shell split natural: both
variants are `Stream.concat(mainStream, Stream.fromQueue(patchQueue))`
(`render-to-stream.ts`) — patches never interleave with the main walk, and
`Boundary.rpc` **blocks** the walk (it is resolved inline, not patched). This is
the Next.js shell-gate model: buffer the main walk (the "shell" — the full
document with Suspense fallbacks inline), decide status, flush it as the first
chunk, then stream patches.

The second feature closes the late-failure gap: today a failure raised inside
`Boundary.suspend` children _after_ the shell has conceptually flushed is
silently swallowed — the resolution fiber is `Effect.ignore`d
(`render-to-stream.ts`), no patch is emitted, and the fallback persists
forever. The seam makes that behaviour explicit and extensible: a consumer may
substitute its own content (Next.js parity: HTTP 200 + not-found UI +
client-injected `<meta name="robots" content="noindex">`, Googlebot's
soft-404 pattern).

## API

### `renderToHydratableShell`

```ts
renderToHydratableShell(node: Renderable): Effect.Effect<
  {
    readonly shell: string;
    readonly patches: Stream.Stream<string>;
  },
  Error,
  AppRpcClientTag | Scope.Scope
>
```

- **`shell`** — the fully buffered main walk: byte-identical to the
  `mainStream` portion of `renderToStreamHydratable` for the same tree. It
  contains reactive-region markers, Suspense fallbacks inline with their
  `<!-- suspense-start-N -->` / `<!-- suspense-end-N -->` markers, resolved
  (blocking) `Boundary.rpc` regions with their payload scripts, and
  failure-boundary fallbacks with their encoded failure payloads.
- **`patches`** — the Suspense patch queue exposed as a stream. It never
  fails (resolution fibers handle their own errors — see the failure-handler
  seam below), and it completes when all pending boundaries have resolved
  their patch (or immediately, if the tree contains no `Boundary.suspend`).
- **Failure** — any error raised during the main walk (unsupported node type,
  a stream failure from a blocking `Boundary.rpc` defect, a user error such as
  the router's `RouterNotFound` escaping the tree) fails the returned Effect.
  Nothing has been handed to the consumer yet, so the caller is free to react
  with a different document and a real HTTP status (this is where
  `RouterNotFound` → 404 lives).
- **Scope** — Suspense resolution fibers are forked into the provided
  `Scope.Scope`. The caller must keep the scope open until `patches`
  completes, and closing the scope interrupts any still-pending resolution
  fibers (the consumer-disconnect path). The exact forking mechanics are
  implementation freedom; this spec pins only the observable contract
  (AC-SH6).

### `SuspenseFailureHandlerTag`

An ambient, **optional** service (like `AppRpcClientTag` — the seam lives in
`@weftui/dom` so dom never imports router). Read via `Effect.serviceOption`
inside the Suspense resolution fiber; absent service means current behaviour.

```ts
interface SuspenseFailureHandler {
  readonly handle: (cause: Cause.Cause<unknown>) => Option.Option<{
    /** Rendered (hydratable pass) as the patch content for the failed boundary. */
    readonly content: Renderable;
    /** When true, the patch script also injects
     * `<meta name="robots" content="noindex">` into `document.head`
     * before performing the swap. */
    readonly markNoindex: boolean;
    /** Optional already-Schema-encoded, JSON-serializable failure value. When
     * present, the patch switches to the failure-replay variant (AC-FH7) so the
     * client hydrate can replay the failure to its nearest boundary. */
    readonly failureReplay?: unknown;
  }>;
}
```

- **Failure precedence.** A failure `Boundary` _inside_ the suspended children
  catches first — the existing `renderBoundarySSR` path is unchanged and the
  patch contains that boundary's fallback (plus encoded failure payload, per
  `server-boundary-ssr.specs.md`). Only causes left **unhandled** by the
  children's own boundaries reach the seam.
- **Opt-out.** Seam absent from context, or `handle` returning `Option.none()`
  for a given cause ⇒ current behaviour exactly: the failure is swallowed, no
  patch is emitted for that boundary, the fallback persists, and the patch
  stream still terminates (the pending count is decremented regardless).
- **`markNoindex`.** By the time a late failure occurs, `<head>` has long been
  flushed — DOM injection from the patch script is the only route (the same
  constraint Next.js operates under). The patch script appends the meta
  element to `document.head` before swapping the boundary content.
- The seam applies to **both** combined-stream variants and the shell-split
  API: it lives in the resolution fiber, which is shared.

## Acceptance criteria

### Shell-split (`renderToHydratableShell`)

- **AC-SH1 (shell equivalence):** For any tree that produces no late
  (post-walk) failures, `shell + Stream.mkString(patches)` is byte-identical
  to `Stream.mkString(renderToStreamHydratable(node))`. All serialization and
  Suspense ACs from `render-to-stream.specs.md` and `suspense-ssr.specs.md`
  therefore hold for the recombined output.
- **AC-SH2 (shell failure propagation):** An error raised during the main walk
  (e.g. unsupported node type per AC-ST4, a blocking `Boundary.rpc` transport
  defect, or any user-thrown error not caught by a failure `Boundary` in the
  tree) fails the returned Effect with that error. No `shell` string and no
  `patches` stream are produced; no resolution fiber outlives the failure.
- **AC-SH3 (patch ordering):** `patches` emits one chunk per resolved boundary
  in **resolution order**, not document order — identical to AC-SS4. Document
  order is not required.
- **AC-SH4 (no-suspense tree):** For a tree without `Boundary.suspend`,
  `patches` completes immediately upon first pull, emitting no chunks
  (AC-SS7 analogue), and `shell` equals
  `renderToStringHydratable(node)`'s output.
- **AC-SH5 (shell-before-patches timing):** The Effect resolves (shell
  available) without waiting for any pending Suspense children — a boundary
  whose child never resolves still yields a shell promptly (fallback inline,
  per AC-SS6 `patches` then stays open).
- **AC-SH6 (scope interruption):** Closing the provided `Scope` while
  boundaries are still pending interrupts their resolution fibers; `patches`
  terminates without emitting further chunks. This is the
  consumer-disconnect path.

### Failure-handler seam (`SuspenseFailureHandlerTag`)

- **AC-FH1 (invoked once per failed boundary):** When a Suspense resolution
  fiber fails with a cause unhandled inside the children, and the seam is
  present, `handle(cause)` is called exactly once for that boundary. Multiple
  independently failing boundaries each invoke the handler once with their own
  cause.
- **AC-FH2 (substituted patch):** When `handle` returns `Option.some({ content })`,
  the boundary's patch is emitted with `content` rendered through the same
  (hydratable) render pass as ordinary resolved children — markers and all —
  targeting the boundary's own ID. The pending count decrements and the
  stream terminates normally.
- **AC-FH3 (noindex injection):** With `markNoindex: true`, the patch script
  appends `<meta name="robots" content="noindex">` to `document.head` before
  performing the content swap. With `markNoindex: false`, no meta element is
  injected and the patch script is otherwise identical to the standard patch
  script (`suspense-ssr.specs.md` § Patch Script Specification).
- **AC-FH4 (opt-out = current behaviour):** Seam absent, or `handle` returns
  `Option.none()` ⇒ no patch for that boundary, fallback persists, no error
  surfaces to the stream consumer, and the patch stream still terminates once
  all other boundaries settle (the failed boundary still decrements the
  pending count).
- **AC-FH5 (inner failure `Boundary` takes precedence):** A failure `Boundary`
  inside the suspended children that matches the cause handles it as today
  (fallback + encoded payload in the patch); the seam's `handle` is **not**
  invoked for that cause.
- **AC-FH6 (handler render failure):** If rendering the handler's `content`
  itself fails, the behaviour degrades to AC-FH4 (swallow, decrement,
  terminate) — a failing handler never crashes the outer scope or hangs the
  stream.
- **AC-FH7 (failure-replay patch):** When the substitute carries a
  `failureReplay` value, the boundary's patch is emitted in the
  **failure-replay variant**:
  - The swap **retains** the boundary's `<!-- suspense-start-N -->` /
    `<!-- suspense-end-N -->` comment markers in the document (the standard
    patch removes them), so the client hydrate can locate the substituted
    region's extent.
  - The swapped-in content is **prepended** with a sentinel
    `<script type="application/json" data-weft-suspense-failure>{"error":<encoded failureReplay>}</script>`
    (JSON embedded with the same `</`-escaping as the boundary-failure
    payload), giving hydrate the machine-readable failure to replay.
  - `markNoindex` behaviour (AC-FH3) is unchanged and composes with this
    variant.
  - A substitute **without** `failureReplay` keeps today's patch format
    exactly (AC-FH2/AC-FH3 — markers removed, no sentinel).

## Out of scope

- Implementation, mocks, and tests (later session, per the spec → mock → test
  → implement cycle).
- Progressive shell flushing (chunked shell before the walk completes) — the
  shell is atomic by design here.
- A shell-split variant of the non-hydratable `renderToStream` (no consumer).
- Changes to the combined-stream variants' output (see
  `render-to-stream.specs.md` — they remain the equivalence baseline).
