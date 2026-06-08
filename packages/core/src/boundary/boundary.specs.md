# Boundary — Core API Spec

## Overview

The `Boundary` namespace groups the subtree-wrapping boundaries: the **failure boundaries** (`catchAll`, `catchAllCause`, `catchTag`, `catchTags`, `catchSome`, `catchIf`) that intercept rendering-path errors, and the **suspense boundary** (`suspend`) that shows a fallback while async children are pending (spec'd in `dom/.../suspense.specs.md`). Each variant returns a plain descriptor `{ type, props }` that the renderer detects and handles. The `type` field is a symbol tag — `FAILURE_BOUNDARY` for the failure variants, `SUSPENSE_BOUNDARY` for `suspend`; for failure boundaries, variant-specific matching logic is encoded in a `match` function stored in `props`.

The failure boundaries only catch **rendering-path** errors:

- Construction-time failures — the Effect phase of building child nodes
- Post-mount stream/prop failures — streams driving children or prop values

Event handler errors are explicitly **not** caught — they run in detached fibers outside the render path and should be handled within the handler itself.

---

## Acceptance Criteria

### Descriptors

1. Each failure `Boundary.*` call returns a plain object `{ type: FAILURE_BOUNDARY, props }` (and `Boundary.suspend` returns `{ type: SUSPENSE_BOUNDARY, props }`) — not a meaningful Effect — so the renderer can process it synchronously via the `{ type, props }` branch.
2. For the failure variants, `props` contains:
   - `match: (cause: Cause.Cause<unknown>) => Node<unknown, unknown> | null` — returns a fallback `Node` if the cause is handled by this variant, `null` if the error should re-raise to a parent boundary or mount
   - `children: readonly Renderable[]`
3. The `FAILURE_BOUNDARY` and `SUSPENSE_BOUNDARY` symbols are exported from `@weftui/core` for use by renderers.

### `Boundary.catchAll`

4. `match` always returns `fallback(error)` for any `Cause` that contains a failure (i.e. `Cause.failureOption` is `Some`). Defects (`Cause.die`) are **not** caught — `match` returns `null` for pure defects.
5. Output `E` is `FallbackE` (the fallback's own error channel) — the children's `E` is fully consumed.
6. Output `R` is `ChildrenR | FallbackR`.

### `Boundary.catchAllCause`

7. `match` always returns `fallback(cause)` for any `Cause`, including defects and interruptions.
8. Output `E` is `FallbackE`. Output `R` is `ChildrenR | FallbackR`.

### `Boundary.catchTag`

9. `match` returns `fallback(error)` only when `Cause.failureOption` is `Some` and the failure's `_tag` equals `props.tag`. Returns `null` otherwise.
10. The `fallback` parameter is typed to receive `Extract<ChildrenE<C>, { _tag: Tag }>`.
11. Output `E` is `Exclude<ChildrenE<C>, { _tag: Tag }> | FallbackE` — the matched tag is removed from the union.
12. Output `R` is `ChildrenR | FallbackR`.

### `Boundary.catchTags`

13. `props` for `catchTags` is the handlers record directly (no wrapping object) — keys are tag names, values are `(e: TaggedError) => Node` functions.
14. `match` returns `handlers[error._tag](error)` when the failure's `_tag` has a corresponding handler. Returns `null` otherwise.
15. Output `E` excludes all tags present as keys in the handlers record.
16. Output `R` is `ChildrenR | union of all FallbackR from handlers`.

### `Boundary.catchSome`

17. `match` calls `fallback(error)` and returns the resulting `Node` if the fallback returns `Option.some(node)`, or `null` if it returns `Option.none()`.
18. Output `E` preserves all of `ChildrenE<C>` (the boundary may or may not handle any given error).
19. Output `R` is `ChildrenR | FallbackR`.

### `Boundary.catchIf`

20. `match` calls `predicate(error)` and returns `fallback(error)` if the predicate returns `true`, or `null` if it returns `false`.
21. Output `E` preserves all of `ChildrenE<C>`.
22. Output `R` is `ChildrenR | FallbackR`.

### Call signature (all variants)

23. Props object is the first argument; children array is the second — consistent with `Suspense` and the `h` namespace.
24. `Boundary.catchTags` takes the handlers record as the first argument directly (it is the props).

---

## API Surface

```typescript
import { Boundary } from "@weftui/core";

// Catch all typed failures
Boundary.catchAll(
  { fallback: (e: E) => Node<FE, FR> },
  children: readonly Renderable[],
): Node<FE, ChildrenR | FR>

// Catch all causes including defects
Boundary.catchAllCause(
  { fallback: (cause: Cause.Cause<E>) => Node<FE, FR> },
  children: readonly Renderable[],
): Node<FE, ChildrenR | FR>

// Catch a specific tagged error
Boundary.catchTag(
  { tag: "NetworkError", fallback: (e: NetworkError) => Node<FE, FR> },
  children: readonly Renderable[],
): Node<Exclude<ChildrenE, NetworkError> | FE, ChildrenR | FR>

// Catch multiple tagged errors
Boundary.catchTags(
  { NetworkError: (e: NetworkError) => Node, AuthError: (e: AuthError) => Node },
  children: readonly Renderable[],
): Node<Exclude<ChildrenE, NetworkError | AuthError> | FE, ChildrenR | FR>

// Conditionally catch — fallback returns Option
Boundary.catchSome(
  { fallback: (e: E) => Option.Option<Node<FE, FR>> },
  children: readonly Renderable[],
): Node<ChildrenE | FE, ChildrenR | FR>

// Conditionally catch — predicate gates the fallback
Boundary.catchIf(
  { predicate: (e: E) => boolean, fallback: (e: E) => Node<FE, FR> },
  children: readonly Renderable[],
): Node<ChildrenE | FE, ChildrenR | FR>
```
