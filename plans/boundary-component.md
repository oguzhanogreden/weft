# Boundary Component — Implementation Plan

## What we did

Designed and specced a `Boundary` namespace for error boundaries in Weft. Two spec files were written:

- `packages/core/src/boundary/boundary.specs.md`
- `packages/dom/src/client/boundary.specs.md`

### Key design decisions

**API** — six variants, props-first / children-last (mirrors `Suspense` and `h`):

```typescript
Boundary.catchAll({ fallback: (e: E) => Node }, children);
Boundary.catchAllCause({ fallback: (cause: Cause<E>) => Node }, children);
Boundary.catchTag({ tag: "Foo", fallback: (e: FooError) => Node }, children);
Boundary.catchTags({ Foo: (e: FooError) => Node, Bar: (e: BarError) => Node }, children);
Boundary.catchSome({ fallback: (e: E) => Option<Node> }, children);
Boundary.catchIf({ predicate: (e: E) => boolean, fallback: (e: E) => Node }, children);
```

**Descriptor shape** — like `Suspense`, each variant returns a plain `{ type: BOUNDARY, props }` object (not an Effect). Variant logic is encoded in a `match: (cause: Cause<unknown>) => Node | null` closure in props — one renderer branch handles all six variants. `null` from `match` means re-raise to parent boundary or mount.

**What is caught** — rendering-path errors only:

- Construction-time failures (Effect phase of building child nodes)
- Post-mount stream/prop failures (streams driving children or prop values)
- Event handler errors are explicitly NOT caught — they run in detached fibers outside the render path

**`BoundaryContext` service** — parallel to `SuspenseContext` in `@weftui/dom`. Provided to children during rendering via `Effect.provideService` (inner boundaries shadow outer ones). Has `reportError(cause)` and a `parent` reference for propagating unmatched errors up the boundary stack.

**`subscribeToStream` modification** — after forking the subscription fiber, catch all causes and route to `BoundaryContext` if present; swallow otherwise (preserving current behavior outside any boundary).

**Recovery fiber** — forked into `context.scope` (not the subtree scope). Awaits error Deferred; on trigger: closes subtree scope, calls `match`, swaps DOM to fallback.

**SSR**:

- Non-hydratable (`renderToString`, `renderToStream`): try children, render fallback inline on error, no markers.
- Hydratable (`renderToStreamHydratable`): on error, emit `<!-- boundary-start-N errored -->` + inline `<script>` storing JSON-serialized error in `window.__efb[N]` + fallback HTML + `<!-- boundary-end-N -->`. On success: transparent (no markers).

**Hydration**: inspect comment marker. No marker → transparent. `errored` marker → read `window.__efb[N]`, reconstruct `Cause`, call `match` to get fallback Node, hydrate fallback against existing DOM, then set up client boundary normally.

---

## Next session: pick up here

The specs are complete. Follow the project's spec → mock → test → implement cycle:

### Step 1 — Mocks (`packages/core/src/boundary/`)

Create `packages/core/src/boundary/index.ts` using `declare` statements to define the complete API surface:

- `export const BOUNDARY: unique symbol`
- `export interface BoundaryProps` (the internal descriptor props shape with `match` + `children`)
- `export namespace Boundary` with all six variants as declared functions
- Type utilities needed: a `CatchTagE<C, Tag>` helper (= `Exclude<ChildrenE<C>, { _tag: Tag }>`) and `CatchTagsE` equivalent — use these in the variant signatures

Export `BOUNDARY` and `Boundary` from `packages/core/src/index.ts`.

### Step 2 — Mocks (`packages/dom/src/`)

In `packages/dom/src/data.ts`, declare `BoundaryContext` as a `Context.Tag` alongside `SuspenseContext`.

In `packages/dom/src/client/render.ts`, add `declare` stubs for:

- `renderBoundary(props: BoundaryProps): Effect<readonly Node[], ...>`
- The modified `subscribeToStream` signature (same externally, catches routed internally)

In `packages/dom/src/server/render-to-stream.ts`, add a `declare` stub for `renderBoundarySSR`.

### Step 3 — Tests

Co-locate test files next to the source:

- `packages/core/src/boundary/boundary.test.ts` — descriptor shape, type-level tests in `__type-tests__/boundary.test-d.ts`
- `packages/dom/src/client/boundary.test.ts` — construction-time catch, post-mount stream catch, nested boundaries, partial catches (catchTag re-raise)
- `packages/dom/src/server/boundary-ssr.test.ts` — fallback HTML on error, errored markers, error serialization, transparent on success

### Step 4 — Implement

Implement in order:

1. `packages/core/src/boundary/index.ts` — replace declares with real functions
2. `packages/dom/src/data.ts` — add `BoundaryContext` tag
3. `packages/dom/src/client/render.ts`:
   - Add `renderBoundary`
   - Modify `subscribeToStream` to catch and route errors
   - Add `BOUNDARY` branch in `renderNode` and `hydrateNode`
4. `packages/dom/src/server/render-to-stream.ts` — add `BOUNDARY` branch in `renderSSRNode` and `renderHydratableSSRNode`

After each file: `vp check --fix && vp test`.
