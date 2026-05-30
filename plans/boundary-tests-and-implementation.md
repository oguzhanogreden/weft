# Boundary — Tests & Implementation Plan

## Context

Mocks are complete. `BOUNDARY`, `BoundaryProps`, `BoundaryContext`, and all six `Boundary.*` variants are declared and exported. The next two steps from the original plan are:

- **Step 3** — write tests against the declared API surface
- **Step 4** — replace `declare` stubs with real implementations

Run `vp check --fix && vp test` after each file.

---

## Step 3: Tests

### `packages/core/src/boundary/boundary.test.ts`

Unit-test the descriptor factory and `match` logic. No DOM, no renderer — just call the variants and inspect the returned descriptor.

Key test cases (matching `boundary.specs.md` acceptance criteria):

| Criterion                   | What to assert                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| AC1 — descriptor shape      | Each variant returns `{ type: BOUNDARY, props: { match, children } }`                      |
| AC4 — `catchAll` match      | `match(Cause.fail(e))` → calls `fallback(e)`; `match(Cause.die("x"))` → `null`             |
| AC7 — `catchAllCause` match | `match(Cause.die("x"))` → calls `fallback(cause)`                                          |
| AC9 — `catchTag` match      | `match(Cause.fail(new FooError()))` with `tag: "Foo"` → calls fallback; wrong tag → `null` |
| AC14 — `catchTags` match    | Routes to correct handler by `_tag`; returns `null` for unregistered tags                  |
| AC17 — `catchSome` match    | `fallback` returns `Option.some(node)` → returns node; `Option.none()` → `null`            |
| AC20 — `catchIf` match      | Predicate `true` → calls `fallback`; predicate `false` → `null`                            |
| AC23/24 — call shape        | All variants accept `(props, children)`; `catchTags` accepts `(handlers, children)`        |

Use `Effect.runSync` to unwrap the returned `Node` (which is an `Effect.sync(...)`) and inspect the `type`/`props` fields directly.

---

### `packages/dom/src/client/boundary.test.ts`

Integration tests against the DOM renderer. Pattern: follow `suspense.test.ts` for helpers (`runMount`, `createRoot`, etc.).

Key test cases (matching `packages/dom/src/client/boundary.specs.md`):

| AC      | Test description                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------- |
| AC1     | Construction-time error → fallback rendered; boundary markers in DOM                               |
| AC2     | Post-mount stream failure → DOM swaps to fallback                                                  |
| AC3     | Event handler error does NOT trigger boundary                                                      |
| AC5     | `BoundaryContext` is provided; inner boundary shadows outer                                        |
| AC6     | `catchTag` re-raise: inner boundary's `match` returns `null` → error propagates to parent boundary |
| AC11    | Construction-time `match` returns `null` → error propagates out of `renderBoundary`                |
| AC16    | Comment markers `<!-- boundary-start-N --> … <!-- boundary-end-N -->` present in DOM               |
| AC17/18 | On swap: child nodes removed, fallback inserted between markers                                    |
| AC19    | Markers remain after swap                                                                          |

Edge cases:

- Nested boundaries where inner catches, outer is not triggered
- Nested boundaries where inner re-raises and outer catches
- `catchSome` / `catchIf` with non-matching predicate: error propagates to parent

---

### `packages/dom/src/server/boundary-ssr.test.ts`

Server-rendering tests. Pattern: follow `render-to-stream.test.ts`.

Key test cases (matching `boundary.specs.md` AC22–AC27):

| AC                            | Test description                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| AC22 — non-hydratable error   | Children fail → fallback HTML emitted inline; no markers                                             |
| AC22 — non-hydratable success | Children succeed → rendered inline; no markers                                                       |
| AC22 — `match` returns null   | Error propagates as stream failure                                                                   |
| AC24 — hydratable success     | Boundary is transparent; no boundary markers emitted                                                 |
| AC25 — hydratable error       | `<!-- boundary-start-N errored -->` + `<script>` + fallback HTML + `<!-- boundary-end-N -->` emitted |
| AC26 — hydratable match null  | Error propagates as stream failure                                                                   |
| AC27                          | Boundary ID counter is separate from stream/suspense counters                                        |

---

## Step 4: Implementation

Implement in order; run `vp check --fix && vp test` after each file.

### 4a. `packages/core/src/boundary/index.ts`

Replace the six `declare function` stubs with real functions. Each variant:

1. Builds a `match: (cause) => Node | null` closure encoding the variant's logic
2. Returns `{ type: BOUNDARY as unknown as symbol, props: { match, children } } as unknown as Node<...>`

The cast pattern mirrors `Suspense` exactly. Key `match` implementations:

```typescript
// catchAll — only typed failures, not defects
match: (cause) => {
  const opt = Cause.failureOption(cause);
  return Option.isSome(opt) ? props.fallback(opt.value as E) : null;
};

// catchAllCause — everything
match: (cause) => props.fallback(cause as Cause.Cause<E>);

// catchTag — single tag
match: (cause) => {
  const opt = Cause.failureOption(cause);
  if (Option.isNone(opt)) return null;
  const e = opt.value as { _tag?: string };
  return e._tag === props.tag ? props.fallback(e as TaggedE) : null;
};

// catchTags — handlers record
match: (cause) => {
  const opt = Cause.failureOption(cause);
  if (Option.isNone(opt)) return null;
  const e = opt.value as { _tag?: string };
  const handler = e._tag !== undefined ? handlers[e._tag as keyof Handlers] : undefined;
  return handler ? handler(e as never) : null;
};

// catchSome — Option return
match: (cause) => {
  const opt = Cause.failureOption(cause);
  if (Option.isNone(opt)) return null;
  const result = props.fallback(opt.value as E);
  return Option.isSome(result) ? result.value : null;
};

// catchIf — predicate
match: (cause) => {
  const opt = Cause.failureOption(cause);
  if (Option.isNone(opt)) return null;
  const e = opt.value as E;
  return props.predicate(e) ? props.fallback(e) : null;
};
```

Imports needed: `Cause`, `Option` from `effect`; `Effect` from `effect` (for `Effect.sync`).

---

### 4b. `packages/dom/src/client/render.ts`

**Four changes:**

**① Remove `declare` from `renderBoundary`** — replace with real `function renderBoundary(...)`. Implementation sketch (see `boundary.specs.md` AC10–AC19):

```typescript
function renderBoundary(props: BoundaryProps): Effect.Effect<readonly Node[], ...> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;
    const parentBoundary = yield* Effect.serviceOption(BoundaryContext);

    const id = nextBoundaryId(); // new counter, separate from stream/suspense IDs
    const startMarker = document.createComment(boundaryStartText(id));
    const endMarker   = document.createComment(boundaryEndText(id));

    // Fork a subtree scope for the children
    const subtreeScope = yield* Scope.fork(context.scope, ExecutionStrategy.sequential);
    const subtreeContext = { ...context, scope: subtreeScope };

    // Build a Deferred that fires when a post-mount error is reported
    const errorDeferred = yield* Deferred.make<Cause.Cause<unknown>>();

    const boundaryService: BoundaryContext["Type"] = {
      reportError: (cause) => Deferred.succeed(errorDeferred, cause).pipe(Effect.asVoid),
    };

    // Render children with BoundaryContext provided
    const childNodes = yield* pipe(
      renderChildren(props.children),
      Effect.provideService(BoundaryContext, boundaryService),
      Effect.provideService(RenderContext, subtreeContext),
      Effect.catchAllCause((cause) => {
        // Construction-time failure — try match synchronously
        const fallbackNode = props.match(cause);
        if (fallbackNode === null) return Effect.failCause(cause);
        return pipe(
          Scope.close(subtreeScope, Exit.void),
          Effect.flatMap(() => renderNode(fallbackNode)),
          Effect.map((n) => (Array.isArray(n) ? n : n ? [n] : []) as readonly Node[]),
        );
      }),
    );

    // Recovery fiber: awaits error deferred, swaps DOM on trigger
    const recoveryEffect = Effect.gen(function* () {
      const cause = yield* Deferred.await(errorDeferred);
      const fallbackNode = props.match(cause);
      yield* Scope.close(subtreeScope, Exit.void);

      if (fallbackNode === null) {
        if (Option.isSome(parentBoundary)) {
          yield* parentBoundary.value.reportError(cause);
        } else {
          yield* Effect.failCause(cause);
        }
        return;
      }

      removeNodesBetweenMarkers(startMarker, endMarker);
      const fallbackNodes = yield* renderNode(fallbackNode);
      insertNodesBefore(fallbackNodes, endMarker);
    });

    yield* Effect.forkIn(recoveryEffect, context.scope);

    return [startMarker, ...childNodes, endMarker] as readonly Node[];
  });
}
```

**② `subscribeToStream` — catch and route errors** (AC7–AC9):

After the `yield* Effect.forkIn(effect, context.scope)` line, wrap the forked fiber's error channel:

```typescript
// existing fork:
const fiber =
  yield *
  Effect.forkIn(
    Stream.runForEach(stream, (value) => Effect.sync(() => void onValue(value))),
    context.scope,
  );

// add: catch all causes on the fiber, route to BoundaryContext if present
yield *
  pipe(
    Fiber.await(fiber),
    Effect.flatMap((exit) =>
      Exit.isFailure(exit)
        ? pipe(
            Effect.serviceOption(BoundaryContext),
            Effect.flatMap(
              (opt) => (Option.isSome(opt) ? opt.value.reportError(exit.cause) : Effect.void), // swallow — outside any boundary
            ),
          )
        : Effect.void,
    ),
    Effect.forkIn(context.scope),
  );
```

**③ `renderNode` dispatch** — add `BOUNDARY` branch after the `Suspense` branch:

```typescript
if (node.type === BOUNDARY) {
  return renderBoundary(node.props as BoundaryProps);
}
```

**④ `hydrateNode` dispatch** — add analogous `BOUNDARY` branch (same as renderNode for now; full hydration deferred to AC28–29).

Also add to imports: `BOUNDARY`, `BoundaryContext` from their respective sources; `Deferred`, `Fiber`, `Exit` from `effect`; `boundaryStartText`, `boundaryEndText` from `~/shared`; `nextBoundaryId` from `~/utilities`.

---

### 4c. `packages/dom/src/server/render-to-stream.ts`

**Two changes:**

**① Remove `declare` from `renderBoundarySSR`** — replace with real function:

```typescript
function renderBoundarySSR(
  props: BoundaryProps,
  renderFn: (node: RenderNode) => Stream.Stream<string, Error>,
): Stream.Stream<string, Error> {
  return Stream.unwrapScoped(
    Effect.gen(function* () {
      const childrenNode = props.children as RenderNode;
      return pipe(
        Stream.mkString(renderFn(childrenNode)),
        Effect.map((html) => Stream.make(html)),
        Effect.catchAllCause((cause) => {
          const fallbackNode = props.match(cause as Cause.Cause<never>);
          if (fallbackNode === null) return Effect.fail(new Error("boundary: unhandled error"));
          return Effect.succeed(renderFn(fallbackNode as RenderNode));
        }),
      );
    }),
  );
}
```

**② `renderSSRNode` dispatch** — add `BOUNDARY` branch after the `Suspense` branch in both `renderSSRNode` and `renderHydratableSSRNode`:

```typescript
if (node.type === BOUNDARY) {
  return renderBoundarySSR(node.props as BoundaryProps, (n) => renderSSRNode(n, ctx));
}
```

For `renderHydratableSSRNode`: on success, boundary is transparent (no markers). On error (AC25), emit markers + script + fallback.

---

## Shared utilities to add

**`packages/dom/src/shared.ts`** — add marker text functions alongside existing suspense/stream ones:

```typescript
export const boundaryStartText = (id: number) => `boundary-start-${id}`;
export const boundaryEndText = (id: number) => `boundary-end-${id}`;
```

**`packages/dom/src/utilities.ts`** — add boundary ID counter (separate from stream/suspense counters):

```typescript
let boundaryIdCounter = 0;
export const nextBoundaryId = () => ++boundaryIdCounter;
```

---

## Verification

After each file: `vp check --fix && vp test`.

Final check:

- All boundary test files pass
- `vp check --fix` clean (no new errors)
- Manual smoke in `playground/`: mount a `Boundary.catchAll` wrapping a failing child; confirm fallback renders
