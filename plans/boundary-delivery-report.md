# Boundary — Delivery Report

**Branch:** `feature/boundary`
**Commits:** `1aec210` (implementation) · `2f58793` (docs)
**Files changed:** 24 files, +2881 / -17 lines

---

## What was delivered

### Core package (`@weftui/core`)

**`packages/core/src/boundary/index.ts`** — The `Boundary` namespace with all six variants as real functions (replacing `declare` stubs). Each variant builds a `match` closure encoding its logic and returns a `{ type: BOUNDARY, props: { match, children } }` descriptor cast as `Node<E, R>`.

| Variant         | Match logic                                                                             |
| --------------- | --------------------------------------------------------------------------------------- |
| `catchAll`      | `Cause.failureOption` is Some → call fallback; None (defect) → null                     |
| `catchAllCause` | Always call fallback with the full `Cause`                                              |
| `catchTag`      | failureOption Some and `e._tag === props.tag` → fallback; else null                     |
| `catchTags`     | failureOption Some and `handlers[e._tag]` exists → call it; else null                   |
| `catchSome`     | failureOption Some, call fallback, return `Option.isSome(result) ? result.value : null` |
| `catchIf`       | failureOption Some, `predicate(e)` true → fallback; false → null                        |

**`packages/core/src/boundary/__type-tests__/boundary.test-d.ts`** — Compile-time type tests: verifies `catchAll` consumes children's `E`, `catchTag` removes the matched tag from the output union, `catchSome`/`catchIf` preserve it, and that a plain `{ type, props }` object is not assignable to `Node`.

### DOM package (`@weftui/dom`)

**`packages/dom/src/data.ts`** — `BoundaryContext` service (previously `declare`-only, now the real `Context.Tag` with `reportError` method).

**`packages/dom/src/shared.ts`** — `boundaryStartText(id)` / `boundaryEndText(id)` marker helpers, parallel to the existing suspense and stream marker functions.

**`packages/dom/src/utilities.ts`** — `nextBoundaryId()` with its own module-level counter, separate from the stream/suspense counter.

**`packages/dom/src/client/render.ts`** — Four changes:

1. `renderBoundary(props)` — real implementation. Forks a subtree scope, creates an `errorDeferred`, provides a `BoundaryContext` service to children, and catches construction-time failures synchronously via `catchAllCause`. A recovery fiber awaits `errorDeferred`; on trigger it closes the subtree scope, calls `match`, and either swaps the DOM to the fallback or re-raises to the parent boundary.
2. `subscribeToStream` — after forking the stream fiber, forks a monitor fiber that awaits the fiber exit and routes failures to `BoundaryContext` if present.
3. `handleStreamChild` — same error-routing monitor added (stream children go through this path, not `subscribeToStream`).
4. `renderNode` / `hydrateNode` — `BOUNDARY` branch dispatches to `renderBoundary`; hydration treats the boundary as transparent (children inline, no markers).

**`packages/dom/src/server/render-to-stream.ts`** — `renderBoundarySSR(props, renderFn)` renders children to HTML; on error calls `match`, renders the fallback inline if not null, propagates as stream failure if null. Wired into both `renderSSRNode` and `renderHydratableSSRNode`.

### Tests (36 new test cases)

| File                                           | Cases | What they cover                                                                                                                                |
| ---------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/boundary/boundary.test.ts`  | 28    | Descriptor shape, all six `match` implementations, call shape                                                                                  |
| `packages/dom/src/client/boundary.test.ts`     | 13    | Construction-time catch, post-mount stream swap, nested boundaries, re-raise propagation, marker presence/persistence, event handler isolation |
| `packages/dom/src/server/boundary-ssr.test.ts` | 10    | Success transparency, fallback HTML on error, match-null propagation, hydratable path                                                          |

### Docs and example

- **`docs/api/core.md`** — `Boundary` section with all six variant signatures, E-channel semantics table, and re-raise/nesting example.
- **`docs/guides/getting-started.md`** — "Error boundaries" section with minimal `catchAll` example.
- **`README.md`** — `Boundary` added to the package exports description; `error-boundary` added to the examples table.
- **`examples/error-boundary/`** — standalone Vite app with nine sections (one per concept), type-checking clean.

---

## Challenges and how they were resolved

### 1. Stale dist — `Boundary` was undefined at runtime

After implementing the core package, the DOM package's tests imported `@weftui/core` from `packages/core/dist/index.js`, which was the old pre-implementation build. `Boundary` was `undefined` at runtime despite clean type-checks.

**Fix:** ran `vp pack` from `packages/core` to rebuild the dist, after which the runtime resolved the correct exports.

**Lesson:** workspace packages resolve through their `dist` (per `package.json#exports`), not the `src` directly. Any change to core requires a rebuild before DOM tests can see it.

---

### 2. Stream child errors not reaching `BoundaryContext`

The first pass of `subscribeToStream` got error-routing, but initial DOM tests showed that stream children (JSX children that are Streams or Effects) never triggered the boundary. The reason: stream children go through `handleStreamChild`, not `subscribeToStream`. `subscribeToStream` is only used for _prop_ streams (reactive attribute/style values).

**Fix:** added the same `Fiber.await` + monitor pattern to `handleStreamChild`. Both paths now route failures to the nearest `BoundaryContext`.

---

### 3. Construction-time vs. async errors — test timing

The plan described "construction-time failures" as synchronous. In practice, `Effect.fail(...)` children are always converted to streams by `renderNode` (`Effect.runSync` throws → falls to the stream path). So even a directly-failing Effect becomes an asynchronous stream error. The synchronous `catchAllCause` path in `renderBoundary` only fires when the rendered child itself (not an Effect input) fails during the render tree walk.

**Consequence:** most "construction-time" boundary tests needed `waitFor(50)` to allow the async recovery fiber to run. AC11 ("mount fails when match returns null") needed a synchronously-throwing component (`() => { throw new Error(...) }`) to produce a real construction-time defect that `catchAllCause` catches synchronously, since stream failures never propagate out of `mount`.

---

### 4. `Deferred` shape for the recovery signal

The plan sketched `Deferred.succeed(errorDeferred, cause)`. The implementation used `Deferred.make<void, Cause>()` (failure channel carries the cause) with `Deferred.fail(d, cause)` / `Deferred.await(d).pipe(Effect.flip)`. This works correctly but is less obvious than a `Deferred.make<Cause>()` with `Deferred.succeed`. It was left as-is since it passed type-checks and tests.

---

### 5. Example type errors — `catchTags` handler key constraints

The `CatchTagsSection` demo initially put both `NetworkError` and `AuthError` handlers on a boundary whose child only had `NetworkError`. The `catchTags` type constraint derives valid handler keys from `ChildrenE<C>["_tag"]`, so `AuthError` was rejected.

**Fix:** restructured the demo to use three separate boundaries, each with handler keys that match the actual child's error union — which is arguably better as an example anyway.

The `ToggleSection` stream had a branch mismatch (`Stream.make(h.span(...))` vs `Stream.fromEffect(boundary...)`) that produced a union type `Stream<Node> | Stream<DOMNode>`. Fixed by normalizing both branches to `Stream.fromEffect`.

---

## Result

All 274 tests pass (12 test files). `vp check --fix` is clean across all 73 files. The branch is pushed and ready for review at `feature/boundary`.

The boundary implementation is complete through the DOM client and SSR renderers. SSR hydration (AC28–29 in the boundary spec, which would emit `<!-- boundary-start-N errored -->` markers and inject `window.__efb[N]` error data for client-side pick-up) was intentionally deferred — the boundary renders inline on the server without markers for now, and the hydration walk treats it as transparent.
