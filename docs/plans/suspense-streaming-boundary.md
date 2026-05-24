# Suspense — Multi-Part Implementation Plan

## Context

effect-ui has no loading-state primitive. The workaround today is manual stream concatenation:

```tsx
Stream.concat(
  Stream.make(<Spinner />),
  Stream.fromEffect(fetchData().pipe(Effect.map(renderData))),
);
```

This is verbose, per-component, and cannot coordinate a shared fallback across multiple async siblings. The goal is a `<Suspense fallback={…}>` boundary that shows a single fallback until **all** async children have emitted their first value, then swaps to the resolved content — exactly like SolidJS/React's subtree-coordinated Suspense.

On the server, `renderToStream` / `renderToStreamHydratable` must support React's streaming patch model: emit the fallback inline immediately, fork a resolution fiber per boundary, then append `<template>` + self-removing `<script>` patches after the main document structure as each boundary resolves. Hydration is transparent — patches execute before `hydrate()` is called.

---

## Confirmed Design Decisions

| Question                                      | Decision                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Suspension trigger                            | Function components returning `Effect<JSXNode>` or `Stream<JSXNode>` while inside a `<Suspense>` subtree              |
| DOM insertion                                 | Children render into detached fragment immediately (Effects run in parallel); DOM insertion deferred until all settle |
| Error handling                                | Not part of this feature — a separate `<ErrorBoundary>` covers that                                                   |
| `renderToString`                              | Renders fallback directly, no suspending, children ignored                                                            |
| `renderToStream` / `renderToStreamHydratable` | Streaming patch model (template + script)                                                                             |
| Fallback markers in HTML                      | Comment nodes (consistent with existing `stream-start-N` vocabulary)                                                  |
| Hanging effects                               | User-land timeout responsibility; effect-ui does not add timeouts                                                     |
| Nested Suspense                               | Each boundary independently shows its own fallback; inner overrides outer                                             |

---

## New Concepts

### `SuspenseContext` (client)

An Effect service provided by `<Suspense>` to its subtree. Components returning `Effect`/`Stream` that are rendered under a `<Suspense>` call `register` before forking and `settle` (exactly once, on first emission) when their stream emits. The boundary shows fallback while any child is registered-but-not-settled.

### Sentinel pattern (prevents premature settlement)

`pendingRef` is initialised to `1` (the "render in progress" sentinel). The sentinel is decremented after all children have been walked and registered. This prevents a fast-resolving Effect from triggering the swap while the render loop is still registering siblings.

### Streaming patches (SSR)

When `<Suspense>` is encountered during `renderToStream`:

1. Fallback HTML + comment markers emitted inline (synchronous, part of the main stream)
2. A fiber is forked to resolve the children HTML
3. When resolved, a patch is pushed to a `Queue<string>`:
   ```html
   <template id="ef-s-N">…resolved HTML…</template>
   <script>
     (function(){…find markers, swap, cleanup…})()
   </script>
   ```
4. After the main stream completes, the patch queue is drained until a shutdown signal fires

The injected script locates the comment markers via `TreeWalker` (comment nodes are not selectable via `querySelector`), removes the fallback content between them, inserts the template's content, then removes the markers, template, and script itself.

---

## Part 1 — Specs & Vocabulary

**Goal**: Write acceptance criteria before any implementation. No code changes.

### Files to create

- `packages/dom/src/client/suspense.specs.md` — Client AC covering:
  - AC1: Sync children (no async) — fallback never shown, children inserted directly
  - AC2: Single async child — fallback shown until child settles, then swap
  - AC3: Multiple async siblings — all must settle before swap (shared fallback)
  - AC4: Nested `<Suspense>` — inner boundary is independent; settling inner does not settle outer
  - AC5: `<Suspense>` without fallback prop — renders nothing while pending
  - AC6: Component returning `Effect<JSXNode>` triggers suspension
  - AC7: Component returning `Stream<JSXNode>` triggers suspension (first emission = settled)
  - AC8: Non-component stream children (e.g. `{count.changes}`) do NOT trigger suspension
  - AC9: Cleanup — scope close while pending interrupts swap fiber and child streams
  - AC10: Already-settled on mount (e.g. very fast Effect) — no flash, children inserted synchronously if possible

- `packages/dom/src/server/suspense-ssr.specs.md` — Server AC covering:
  - AC-SS1: `renderToString` with `<Suspense>` — emits fallback, children not rendered
  - AC-SS2: `renderToStream` — fallback + comment markers emitted inline; patch emitted after main stream when boundary resolves
  - AC-SS3: `renderToStreamHydratable` — same as AC-SS2 plus the existing `stream-start-N` markers inside the resolved content
  - AC-SS4: Multiple boundaries — each gets its own patch; patches emitted as each resolves, not all-at-once
  - AC-SS5: Nested boundaries — inner boundary gets its own patch; outer waits independently
  - AC-SS6: A boundary whose Effect never resolves — main stream emits, patch stream stays open (expected; no built-in timeout)

### Files to extend

- `packages/dom/src/client/markers.ts` — Add suspense marker vocabulary alongside stream markers:
  ```typescript
  export function suspenseStartText(id: number): string {
    return ` suspense-start-${id} `;
  }
  export function suspenseEndText(id: number): string {
    return ` suspense-end-${id} `;
  }
  // parseSuspenseMarker(comment): SuspenseMarker | null  (for hydration if needed)
  ```

---

## Part 2 — Client-Side Suspense

### Package placement

`Suspense` follows the exact same pattern as `FRAGMENT`:

- **`@effect-ui/core`** — the JSX type marker and `SuspenseProps` interface. Any renderer can import these and implement the behaviour.
- **`@effect-ui/dom`** — the rendering implementation (`renderSuspenseBoundary`, `SuspenseContext`, SSR patch machinery).

This mirrors `FRAGMENT` (defined in `@effect-ui/core/jsx-runtime`, handled in `@effect-ui/dom`'s `renderNode`). `@effect-ui/dom` already depends on `@effect-ui/core`, so no new cross-package dependencies are introduced.

### Files to create

**`packages/core/src/suspense/index.ts`** (new top-level module in `@effect-ui/core`):

```typescript
import type { JSXNode } from "~/types";

export interface SuspenseProps {
  readonly fallback: JSXNode;
  readonly children?: JSXNode | JSXNode[];
}

/**
 * Suspense boundary. Shows `fallback` while async children are pending,
 * then swaps to children once all have settled (emitted their first value).
 * Rendering behaviour is implemented by the active renderer (@effect-ui/dom).
 */
export function Suspense(props: SuspenseProps): JSXNode {
  void props;
  throw new Error("[effect-ui] Suspense must be rendered inside a mount() or hydrate() call");
}
```

**`packages/core/src/index.ts`** — re-export:

```typescript
export { Suspense } from "./suspense";
export type { SuspenseProps } from "./suspense";
```

**`packages/core/package.json`** — add new export path alongside `./types` and `./jsx-runtime`:

```json
"./suspense": {
  "types": "./dist/suspense/index.d.ts",
  "import": "./dist/suspense/index.js"
}
```

Consumers can import via either `@effect-ui/core` (main entry, re-exported) or `@effect-ui/core/suspense` (direct path). The dom renderer imports from `@effect-ui/core/suspense`.

**`packages/dom/src/client/suspense.ts`** (new in `@effect-ui/dom`):

Contains only `renderSuspenseBoundary` — the actual implementation. Imports `Suspense` from `@effect-ui/core/suspense` for reference equality checks.

```
1. pendingRef = Ref.make(1)          // sentinel
2. allSettled = Deferred.make<void>
3. suspenseService = { register: Ref.update(+1), settle: Ref.updateAndGet(-1) → if 0 Deferred.succeed }
4. childNodes = renderChildren(childArray).pipe(Effect.provideService(SuspenseContext, suspenseService))
5. suspenseService.settle            // release sentinel
6. if Deferred.isDone(allSettled) → return childNodes directly (sync fast-path)
7. boundaryId = nextSuspenseId()
8. fallbackNodes = renderNode(props.fallback)
9. startMarker = createComment(suspenseStartText(boundaryId))
10. endMarker   = createComment(suspenseEndText(boundaryId))
11. fork swapEffect in context.scope:
      Deferred.await(allSettled)
      → removeBetweenMarkers(start, end)
      → insert childNodes before end
12. return [startMarker, ...fallbackNodes, endMarker]
```

**`packages/dom/src/client/suspense.test.tsx`** — tests for all AC1–AC10.

### Files to modify

**`packages/dom/src/data.ts`**

Add `SuspenseContext` alongside `RenderContext`:

```typescript
export class SuspenseContext extends Context.Tag("SuspenseContext")<
  SuspenseContext,
  {
    readonly register: Effect.Effect<void>;
    readonly settle: Effect.Effect<void>;
  }
>() {}
```

**`packages/dom/src/client/render-core.ts`**

Two changes:

1. In `renderNode` (after Fragment check, before string-type check):

   ```typescript
   import { Suspense } from "./suspense";
   // …
   if (type === Suspense) {
     return yield * renderSuspenseBoundary(props as SuspenseProps);
   }
   ```

2. In `renderComponent` — wrap stream when `SuspenseContext` is present:

   ```typescript
   if (isStream(result) || Effect.isEffect(result)) {
     const suspenseCtx = yield * Effect.serviceOption(SuspenseContext);
     let stream = normalizeToStream(result);

     if (Option.isSome(suspenseCtx)) {
       yield * suspenseCtx.value.register;
       // Call settle exactly once, on first emission
       stream = pipe(
         stream,
         Stream.zipWithIndex,
         Stream.flatMap(([value, index]) =>
           index === 0
             ? Stream.fromEffect(Effect.as(suspenseCtx.value.settle, value))
             : Stream.make(value),
         ),
       );
     }

     const markers = yield * handleStreamChild(stream, fragment);
     return markers;
   }
   ```

**`packages/dom/src/utilities.ts`**

Add `nextSuspenseId()` reusing the existing `streamIdCounter` on `RenderContext` (IDs only need to be unique per render tree, not globally unique):

```typescript
export const nextSuspenseId = nextStreamId; // alias — reuse same counter
```

**`packages/dom/src/index.ts`**

No change needed for `Suspense` — it is exported from `@effect-ui/core/jsx-runtime`. Consumers import it from core (the same place as `FRAGMENT`), not from dom.

---

## Part 3 — SSR Streaming Suspense

### Architecture

The recursive `renderInternal` / `renderHydratable` functions currently receive only `(node, counter)`. A `ServerSuspenseCtx` is added as an optional third parameter (default `null` = no Suspense support, maintains backwards compatibility for the non-Suspense code paths).

```typescript
interface ServerSuspenseCtx {
  readonly patchQueue: Queue.Queue<string>; // patch HTML pushed here on boundary resolution
  readonly pendingCount: Ref.Ref<number>; // total unresolved boundaries
}
```

The top-level `renderToStream` / `renderToStreamHydratable` functions wrap the result to:

1. Create a `ServerSuspenseCtx`
2. Render the main document stream (with fallbacks)
3. Append a patch stream after main: drains `patchQueue` until `pendingCount` reaches 0 and the queue is shut down

### Files to modify

**`packages/dom/src/server/render-to-stream.ts`**

Add internal `renderSuspenseSSR(props, counter, ctx)` helper:

```
1. id = ++counter.current
2. Ref.update(ctx.pendingCount, +1)
3. Fork resolution fiber (Effect.fork — SSR has no client Scope):
     childrenHtml = Stream.mkString(renderHydratableInternal(props.children, sharedCounter, ctx))
     patch = buildPatch(id, childrenHtml)   // template + script string
     Queue.offer(ctx.patchQueue, patch)
     remaining = Ref.updateAndGet(ctx.pendingCount, -1)
     if remaining === 0 → Queue.shutdown(ctx.patchQueue)
4. Return Stream.concat(
     Stream.make(`<!--${suspenseStartText(id)}-->`),
     renderHydratableInternal(props.fallback, counter, ctx),
     Stream.make(`<!--${suspenseEndText(id)}-->`)
   )
```

The `buildPatch(id, html)` function produces:

```html
<template id="ef-s-{id}">{html}</template>
<script>
  (function () {
    var w = document.createTreeWalker(document, 128),
      s,
      e;
    while (w.nextNode()) {
      var d = w.currentNode.data;
      if (d === " suspense-start-{id} ") s = w.currentNode;
      if (d === " suspense-end-{id} ") {
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
    var t = document.getElementById("ef-s-{id}");
    p.insertBefore(t.content, e);
    p.removeChild(s);
    p.removeChild(e);
    t.remove();
    document.currentScript.remove();
  })();
</script>
```

The public `renderToStream` and `renderToStreamHydratable` are updated to wire up the `ServerSuspenseCtx` and concat the patch stream:

```typescript
export const renderToStreamHydratable = (node: JSXNode): Stream.Stream<string, Error> =>
  Stream.fromEffect(
    Effect.gen(function* () {
      const patchQueue = yield* Queue.unbounded<string>();
      const pendingCount = yield* Ref.make(0);
      const ctx: ServerSuspenseCtx = { patchQueue, pendingCount };
      const counter: RegionCounter = { current: 0 };

      const mainStream = renderHydratable(node, counter, ctx);
      // Stream.fromQueue terminates when queue is shut down
      const patchStream = Stream.fromQueue(patchQueue);

      return Stream.concat(mainStream, patchStream);
    }),
  ).pipe(Stream.flatten);
```

**`packages/dom/src/server/render-to-string.ts`**

`renderToString`: unchanged (existing behaviour — reactive values collapsed to first emission, no Suspense support).

`renderToStringHydratable`: unchanged — it calls `renderToStreamHydratable` via `Stream.mkString`, so Suspense patches are automatically concatenated into the final string. No code changes needed; the SSR patch `<template><script>` pairs will appear at the end of the string output. (For pure static output where no `hydrate()` is called, this is fine; for client hydration, the scripts execute on load.)

**`packages/dom/src/server/render-to-stream.test.tsx`**

New test cases for AC-SS1 through AC-SS6.

---

## Part 4 — Verification

### Local checks

```bash
vp check          # format + lint + typecheck (requires pack)
vp test           # all tests
```

### Specific test scenarios

**Client (jsdom)**:

- Mount `<Suspense fallback={<span>loading</span>}>` with one `Effect.gen` child that delays 50ms → assert fallback in DOM → wait → assert child in DOM
- Two sibling async children → fallback persists until both settle → single swap
- Nested `<Suspense>` → inner swaps independently of outer
- Scope close while pending → swap fiber interrupted, no crash

**Server**:

- `renderToString` with `<Suspense>` → output contains fallback HTML, no markers, no `<template>`
- `renderToStreamHydratable` with a delayed child → stream emits fallback + markers first, then `<template>` + `<script>` patch after main stream closes
- Multiple boundaries → patch order matches resolution order (not declaration order)

**Round-trip** (SSR → hydration):

- `renderToStringHydratable(<App />)` where `<App>` contains `<Suspense>`
- Inject into JSDOM, run scripts (simulate browser)
- Verify DOM is in resolved state
- Call `hydrate(<App />, root)` → assert no hydration mismatch errors, reactive regions still update

### Example

Add `examples/suspense/` (similar structure to other examples):

- A `<Dashboard>` with three sibling async cards under one `<Suspense>`
- A nested layout showing inner/outer boundaries
- SSR entry + client hydration entry to demonstrate the streaming patch model

---

## Critical Files Summary

| File                                                | Change                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/suspense/index.ts`               | **New** — `Suspense` function + `SuspenseProps` (own module, not nested in jsx-runtime)                            |
| `packages/core/src/index.ts`                        | Re-export `Suspense`, `SuspenseProps`                                                                              |
| `packages/core/package.json`                        | Add `"./suspense"` export path                                                                                     |
| `packages/dom/src/data.ts`                          | Add `SuspenseContext` tag                                                                                          |
| `packages/dom/src/client/markers.ts`                | Add `suspenseStartText`, `suspenseEndText`                                                                         |
| `packages/dom/src/client/suspense.ts`               | **New** — `renderSuspenseBoundary` implementation                                                                  |
| `packages/dom/src/client/suspense.specs.md`         | **New** — AC1–AC10                                                                                                 |
| `packages/dom/src/client/render-core.ts`            | Import `Suspense` from `@effect-ui/core/suspense`; intercept `type === Suspense`; wrap stream in `renderComponent` |
| `packages/dom/src/utilities.ts`                     | Add `nextSuspenseId` alias                                                                                         |
| `packages/dom/src/server/render-to-stream.ts`       | Add `ServerSuspenseCtx`, `renderSuspenseSSR`, patch stream concat                                                  |
| `packages/dom/src/server/suspense-ssr.specs.md`     | **New** — AC-SS1–AC-SS6                                                                                            |
| `packages/dom/src/client/suspense.test.tsx`         | **New**                                                                                                            |
| `packages/dom/src/server/render-to-stream.test.tsx` | Add SSR Suspense test cases                                                                                        |
| `examples/suspense/`                                | **New** example app                                                                                                |

## Reused Patterns

- `removeBetweenMarkers` / `updateStreamChild` from `render-core.ts` — reuse DOM mutation helpers
- `Effect.forkIn(effect, context.scope)` — reuse for the swap fiber
- `Stream.zipWithIndex` + `Stream.flatMap` — settle-on-first-emission wrapper
- `nextStreamId` from `utilities.ts` — reuse for suspense IDs
- `streamStartText`/`streamEndText` pattern from `markers.ts` — same pattern for suspense markers
- `Queue.unbounded<string>()` + `Queue.shutdown` — patch collection channel
- `Deferred.make<void>` — allSettled signal (sentinel pattern)
