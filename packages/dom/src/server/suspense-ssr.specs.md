# Suspense — SSR Streaming Specification

## Overview

The suspense boundary is constructed with `Boundary.suspend(props, children)` and
recognised by the server renderer via its `SUSPENSE_BOUNDARY` symbol type tag.

`renderToStream` and `renderToStreamHydratable` support suspense boundaries via a
**streaming patch model** inspired by React's `renderToPipeableStream`. When the
renderer encounters a suspense boundary:

1. The **fallback** HTML is emitted inline in the main stream, bracketed by
   `<!-- suspense-start-N -->` / `<!-- suspense-end-N -->` comment markers.
2. A background fiber resolves the **children** HTML concurrently.
3. After the main document stream completes, resolved patches are appended to the
   stream: a `<template>` element holding the resolved HTML followed by a
   self-removing `<script>` that performs the DOM swap client-side.

The HTTP connection stays open until all pending boundaries have resolved and their
patches have been emitted.

`renderToString` has simpler behaviour: it emits the fallback directly with no
markers and no patches (children are not rendered at all).

Hydration is transparent: by the time `hydrate()` is called, all `<script>` patches
have already executed and the DOM is in the resolved state.

## Acceptance Criteria

### AC-SS1: `renderToString` — fallback only, children not rendered

- **Given** `renderToString(node)` where `node` contains a `Boundary.suspend({ fallback: F }, children)`
- **When** evaluated
- **Then**:
  - The output contains the serialised HTML of `F`
  - The children of the boundary are **not** rendered
  - No `<!-- suspense-start-N -->` / `<!-- suspense-end-N -->` markers appear
  - No `<template>` or `<script>` elements appear
  - The output string is otherwise identical to rendering `F` inline

### AC-SS2: `renderToStream` — fallback inline, patch after main stream

- **Given** `renderToStream(node)` where `node` contains a `Boundary.suspend({ fallback: F }, children)`
  with an async child whose first emission eventually resolves to `C`
- **When** the stream is consumed
- **Then** the following chunks are emitted in this order:
  1. All chunks before the boundary (in document order)
  2. `<!--${suspenseStartText(N)}-->` (opening marker)
  3. Serialised HTML of `F`
  4. `<!--${suspenseEndText(N)}-->` (closing marker)
  5. All chunks after the boundary (in document order) — the stream does **not**
     wait for the boundary to resolve before emitting subsequent siblings
  6. After the main document structure is complete, when the child resolves:
     ```html
     <template id="ef-s-N">…serialised HTML of C…</template>
     <script>
       (function(){…})()
     </script>
     ```
  7. The stream terminates after all pending patches have been emitted

### AC-SS3: `renderToStreamHydratable` — same as AC-SS2 plus reactive markers

- **Given** `renderToStreamHydratable(node)` with a `Boundary.suspend` whose resolved
  children contain reactive regions (Stream/Effect children or props)
- **When** the stream is consumed
- **Then**:
  - The patch `<template>` content includes `<!-- stream-start-M -->` /
    `<!-- stream-end-M -->` markers around reactive regions within the resolved
    children (the standard hydratable rendering behaviour applied to the resolved
    subtree)
  - All other AC-SS2 behaviour holds

### AC-SS4: Multiple boundaries — independent patches, ordered by resolution time

- **Given** a tree with two or more `Boundary.suspend` boundaries, each with its own async
  child, resolving at different times
- **When** the stream is consumed
- **Then**:
  - Each boundary gets its own numeric ID (`N`, `M`, …) and independent
    `<!-- suspense-start -->` / `<!-- suspense-end -->` marker pair
  - Patches are appended in **resolution order** (not document order): a boundary
    that resolves faster emits its patch first, regardless of its position in the tree
  - Each patch targets only its own boundary via the unique ID
  - The stream terminates only after **all** boundaries have emitted their patch

### AC-SS5: Nested `Boundary.suspend` — inner boundary resolves within outer patch

- **Given** an outer `Boundary.suspend` containing an inner `Boundary.suspend`, each with async
  children
- **When** the outer boundary resolves
- **Then**:
  - The outer `<template>` patch content contains the inner boundary's fallback HTML
    with its own `<!-- suspense-start-M -->` / `<!-- suspense-end-M -->` markers
  - When the inner boundary subsequently resolves, a separate patch is appended for
    the inner boundary
  - Both boundaries have independent IDs and resolve independently

### AC-SS6: Never-resolving boundary — stream stays open

- **Given** a `Boundary.suspend` boundary whose child Effect never emits
- **When** the stream is consumed
- **Then**:
  - The main document stream (with fallback in place) completes normally
  - The patch stream does not terminate
  - The overall stream stays open indefinitely — no timeout, no error
  - This is expected behaviour; the consuming HTTP server is responsible for
    request timeouts and connection management

### AC-SS7: No `Boundary.suspend` in tree — zero overhead

- **Given** `renderToStream(node)` or `renderToStreamHydratable(node)` where `node`
  contains no `Boundary.suspend` boundaries
- **When** the stream is consumed
- **Then**:
  - Output is byte-for-byte identical to the pre-Suspense implementation
  - No `Queue`, `Ref`, or patch infrastructure is created
  - The stream terminates as soon as the document tree is exhausted (no extra
    open tail)

## Patch Script Specification

Each patch consists of a `<template>` + inline `<script>` pair:

```html
<template id="ef-s-N"><!-- resolved children HTML --></template>
<script>
  (function () {
    var w = document.createTreeWalker(document, 128),
      s,
      e;
    while (w.nextNode()) {
      var d = w.currentNode.data;
      if (d === " suspense-start-N ") s = w.currentNode;
      if (d === " suspense-end-N ") {
        e = w.currentNode;
        break;
      }
    }
    if (!s || !e) return;
    var p = s.parentNode,
      c = s.nextSibling,
      n;
    while (c && c !== e) {
      n = c.nextSibling;
      p.removeChild(c);
      c = n;
    }
    var t = document.getElementById("ef-s-N");
    p.insertBefore(t.content, e);
    p.removeChild(s);
    p.removeChild(e);
    t.remove();
    document.currentScript.remove();
  })();
</script>
```

- Comment nodes are located via `TreeWalker` with `NodeFilter.SHOW_COMMENT` (value
  `128`) because `querySelector` cannot select comment nodes.
- The script removes the fallback content between the markers, inserts the template's
  document fragment, then removes the markers, the template element, and itself.
- The script is self-contained: no globals, no dependencies on any client-side
  Weft runtime.

### Substituted-patch (failure-replay) variant

When a `SuspenseFailureHandler` substitute carries a `failureReplay` value
(`streaming-shell.specs.md` AC-FH7), the patch differs from the standard script
in exactly two ways:

1. The `<!-- suspense-start-N -->` / `<!-- suspense-end-N -->` comment markers
   are **retained** in the document — the script skips the two
   `removeChild(s)`/`removeChild(e)` calls. The markers signal to the client
   `hydrate` walk that the region resolved to a handled failure and delimit
   the substituted content's extent.
2. The template content is prepended with a sentinel
   `<script type="application/json" data-weft-suspense-failure>{"error":<encoded>}</script>`
   carrying the Schema-encoded failure, which hydrate parses and replays to the
   nearest failure boundary (`hydrate.specs.md` AC-H14). The sentinel is inert
   (`type="application/json"` never executes).

A substitute **without** `failureReplay`, and every ordinarily-resolved
boundary, keeps the standard script above byte-for-byte.

## Internal Architecture

### `ServerSuspenseCtx`

Threaded as an optional third parameter through the recursive SSR render functions.
When `null` (no Suspense in tree), all recursive calls take the existing fast path.

```typescript
interface ServerSuspenseCtx {
  readonly patchQueue: Queue.Queue<Option.Option<string>>; // Some(patch) | terminal None
  readonly pendingCount: Ref.Ref<number>; // boundaries not yet resolved
}
```

### Stream structure

```
renderToStream(node)
  └─ mainStream   — document structure with fallbacks inline
  └─ patchStream  — Stream.fromQueue(patchQueue) up to the terminal None
  └─ combined     — Stream.concat(mainStream, patchStream)
```

Patches are offered as `Some`; a terminal `None` is offered when `pendingCount`
reaches 0 (all boundaries resolved), ending the patch stream **after** every
queued patch has been consumed (a `Queue.shutdown` would drop patches still
queued when the consumer attaches late — e.g. a synchronously-settling
boundary). If no `Boundary.suspend` boundaries exist, `pendingCount` never
increments, the terminal `None` is offered immediately after the main stream
completes, and the combined stream terminates without emitting any patches.

### Per-boundary resolution fiber

For each `Boundary.suspend` encountered during the main render:

1. Increment `pendingCount`
2. Emit fallback + markers into the main stream (synchronous, in document order)
3. Fork a detached fiber (`Effect.fork`) to resolve the children:
   - Render children to an HTML string via `Stream.mkString`
   - Build the patch string
   - `Queue.offer(patchQueue, patch)`
   - Decrement `pendingCount`; if 0, `Queue.shutdown(patchQueue)`

## Constraints

- `renderToString` does not support Suspense streaming; fallback is always shown
- Patch scripts require JavaScript enabled on the client; JS-disabled environments
  always see the fallback
- Nested `Boundary.suspend` boundaries require the outer boundary's children HTML to be
  rendered before the inner boundary's patch can be emitted — resolution is naturally
  ordered by the async dependency graph
- No built-in timeout; the stream may stay open indefinitely if a boundary's Effect
  never resolves
