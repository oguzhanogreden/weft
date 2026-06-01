# Design plan: `onElement` — a reusable element-ref observer combinator

> Status: **design only.** This doc seeds the repo's `spec → mock → test → implement`
> cycle. No `@effect-ui/core` code is written from this round — start with a Q&A spec
> pass and a co-located `*.spec.md` before any implementation.

## Problem

Recipes that need to run an effect once a `ref`'s DOM element is mounted (auto-focus,
measure, draw on a canvas) currently hand-roll the same observer pipeline inside the
component body:

```ts
yield *
  pipe(
    ref.changes,
    Stream.filter(Option.isSome),
    Stream.take(1),
    Stream.runForEach((option) => doSomething(option.value)),
    Effect.forkScoped,
  );
```

Two hazards make this error-prone to write by hand:

1. **Wrong fork.** A bare `Effect.fork` binds the observer to the transient
   component-body fiber, which is interrupted the instant the gen returns the tree —
   so the side effect silently never runs under an isolated `mount` (it usually wins
   the race under `vp dev`, which masks the bug). `Effect.forkScoped` is required so
   the observer is tied to the component instance scope (the ambient `Scope.Scope`
   the DOM renderer provides per component — see `packages/dom/src/client/render.ts`
   `renderComponent`, where `instanceScope` is provided as both `RenderContext.scope`
   and `Scope.Scope`).
2. **Boilerplate.** `filter(isSome)` + `take(1)` + `runForEach` is repeated verbatim
   and easy to get subtly wrong (e.g. forgetting `take(1)` and re-running on every
   change).

`examples/element-ref/app.ts` repeats this block three times (`AutoFocusInput`,
`MeasureElement`, `CanvasDrawing`). They are the first concrete use cases — enough to
justify a shared combinator (the repo's rule is to wait for multiple use cases before
abstracting; this clears it).

## Proposed API

A combinator in `@effect-ui/core` that captures the canonical pattern and bakes in the
correct (`forkScoped`) lifetime:

```ts
/**
 * Runs `f` once, with the live DOM element, the first time `ref` is populated
 * after mount. The observer is forked into the ambient component instance scope
 * (Effect.forkScoped), so it lives as long as the component is mounted and is
 * torn down with it. Intended to be `yield*`-ed from inside a component body.
 */
export const onElement: <A extends Element, E, R>(
  ref: SubscriptionRef.SubscriptionRef<Option.Option<A>>,
  f: (element: A) => Effect.Effect<void, E, R>,
) => Effect.Effect<void, never, R | Scope.Scope>;
```

Open questions to resolve in the spec pass (Q&A, one at a time):

- **Once vs. every mount.** Default to first-emission-only (`take(1)`)? Or also offer
  an `onElementChanges` variant that runs on every `Some` (e.g. for refs that swap
  elements)? Recommendation: ship `onElement` (once) first; defer the changes variant
  until a use case appears.
- **Sync convenience overload.** Accept `(element: A) => void` in addition to an
  `Effect`? Most recipes (`focus()`, `getBoundingClientRect()`, canvas draw) are
  synchronous. Recommendation: single Effect-returning signature; callers wrap with
  `Effect.sync`/`Effect.gen` as they do today — keeps one code path, matches the
  "type-level when possible / Effect throughout" house style.
- **Error channel.** Recipe side effects are infallible (`E = never`) today. Keep `E`
  generic so a failing `f` surfaces on the forked fiber; document that failures are
  not routed to a boundary (unlike stream _children_). Confirm this is acceptable.
- **Scope requirement.** Signature carries `Scope.Scope` in `R` so misuse outside a
  scoped context is a type error. Confirm the renderer always satisfies this in a
  component body (it does — `renderComponent` provides `Scope.Scope`).

## Placement

`packages/core/src/combinator/` — alongside `h`, `List`, `Component` (the
element/component-facing combinators). Add `onElement` to `combinator/index.ts`, which
is re-exported from `packages/core/src/index.ts`. Co-locate `on-element.ts`,
`on-element.spec.md`, `on-element.test.ts`, and a `__type-tests__/on-element.test-d.ts`
(assert the `Scope.Scope` requirement and the element-type inference).

Reuse, don't reinvent: the body is exactly the existing pipeline (`Stream.filter` +
`Stream.take(1)` + `Stream.runForEach` + `Effect.forkScoped`).

## How the recipes collapse

`examples/element-ref/app.ts` each ~8-line block becomes one call:

```ts
// AutoFocusInput
yield * onElement(inputRef, (el) => Effect.sync(() => el.focus()));

// MeasureElement
yield *
  onElement(boxRef, (el) =>
    SubscriptionRef.set(dimensions, formatRect(el.getBoundingClientRect())),
  );

// CanvasDrawing
yield * onElement(canvasRef, (el) => Effect.sync(() => draw(el.getContext("2d"))));
```

The existing `examples/element-ref/app.browser.test.ts` (auto-focus + measure + scroll
assertions) then doubles as the integration test proving the helper behaves under a
real `mount`.

## Out of scope

- No change to `mount`'s contract. `mount` resolving before background streams paint is
  specced (`packages/dom/src/client/dom.specs.md:21,145,345`); tests assert post-mount
  state with `vi.waitFor`, which is correct.
- No `onElementChanges` (multi-emission) variant until a use case exists.

## Next steps

1. Q&A spec discussion to settle the open questions above.
2. Write `combinator/on-element.spec.md` (overview, acceptance criteria, edge cases).
3. Mock the signature (`declare`), write tests + type tests.
4. Implement, refactor the three recipes onto it, validate with `vp run check` /
   `vp run test` / `vp run test:browser`.
