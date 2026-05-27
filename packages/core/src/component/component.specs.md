# `@effect-ui/core` — Component Definition & Prop Normalization

## Overview

`Component.gen` defines a component from an `Effect.gen`-style generator body. It
exists to make the two faces of a prop type magically asymmetric:

- **Caller / JSX side** — every slot accepts `Source<T>`, so a prop
  declared `name: string` accepts `"x"`, `Stream<string>`, `Effect<string>`, or
  an existing `Subscribable<string>` interchangeably.
- **Author / inside side** — the generator body receives the same props mapped
  to `Subscribable<T, NoPropValue>`: read-only handles that expose both a live
  stream (`.changes`) and an await-first current value (`.get`).

The author writes the raw prop shape **once** (as the `Component.gen` type
argument); both faces are derived from it. `children` is the sole exception — it
is exempt from wrapping on both faces (see _Children are exempt on both faces_).

## Purpose

A component declared as

```tsx
const Greeting = Component.gen<{ name: string }>(function* (props) {
  // props.name: Subscribable<string, NoPropValue>
  return <div>{props.name.changes}</div>;
});
```

is callable as any of:

```tsx
<Greeting name="claude" />
<Greeting name={Stream.make("claude")} />
<Greeting name={Effect.succeed("claude")} />
<Greeting name={someSubscribable} />
```

The body is a generator: it may `yield*` Effects — including `props.x.get` to read
a current value — and `return`s the `JSXNode`. `Component.gen` normalizes each
incoming `Source<T>` prop into a uniform await-first
`Subscribable<T, NoPropValue>` (via `toSubscribable`) and assembles them into the
`Reactive<P>` object handed to the body:

```tsx
const Greeting = Component.gen<{ name: string }>(function* (props) {
  const name = yield* props.name.get; // current value, await-first
  return <div>Hello, {name}</div>;
});
```

## Design Decisions

### Inside type is `Subscribable<T>`, not `Stream<T>`

`Subscribable` is the `BehaviorSubject` to `Stream`'s `Observable`: it carries a
live `changes` stream **and** a current value via `get`. Props need
"current value now" constantly (event handlers, validation, conditional logic),
and that capability is inherently stateful — there is no stateless way to read
"latest without re-running the source" (`Sink.last` runs to completion and only
yields the _final_ value of a _finite_ stream; useless for a live prop). Since a
hot/shared prop already requires a `SubscriptionRef` to avoid re-running the
source per consumer, `get` is nearly free once that ref exists — so we expose it.

### `get` is **await-first** (Option A)

For a prop whose source has not emitted yet, `get`:

- returns the **latest** value if one has been emitted;
- otherwise **awaits the first emission**;
- **fails with `NoPropValue`** only if the source _ends_ before ever emitting.

Rationale: one rule across all three sources — _"`get` yields a value or
fails"_ — true regardless of how the caller supplied the prop. The alternative
("snapshot": fail immediately if nothing yet) makes behavior depend on a
mount-vs-emit race the author cannot see, since the source kind is hidden behind
`Source`. Await-first removes the race; waiting is visible in the types
(`get` is an `Effect`) and tameable with timeouts / Suspense / interruption.

### Absence lives in the error channel, not in `Option`

The only source that can legitimately never emit is a `Stream`. Static props are
always present; `Effect` props always resolve (succeed or fail). So absence is
**narrow** and is modeled as a typed failure `NoPropValue` in `Subscribable`'s
`E` channel — _not_ `Subscribable<Option<T>>`, which would tax every read to
model a branch only stream-sourced props can hit.

### Props are hot / shared

A prop's emissions are shared across all consumers (DOM binding, handlers,
derivations) via a `SubscriptionRef`-backed pump, so the underlying source runs
**once**, not once per read. This is required for correctness (no double-fetch
when a prop came from an `Effect`).

### Identity pass-through (zero re-wrap cost)

`Source<T>` includes `Subscribable<T>`, and `toSubscribable`
short-circuits to identity when handed one. Therefore a prop threaded down
untouched (`<Child name={props.name} />`) flows as the **same `Subscribable`
reference** through arbitrary depth — one ref, one fiber, shared by every level
(O(1), zero allocation). A fresh ref+fiber is created **only** when the author
actually transforms a prop (`Stream.map` over `.changes`), which is genuinely new
reactive data that needs its own sharing. The pump fiber lives in the scope of
the component that _originated_ the value, so it always outlives downstream
consumers.

**Author guidance:** thread `props.name` itself to forward a prop (preserves
identity); reach for `.changes` only to bind at a terminal leaf (DOM) or to
transform.

### Children are exempt on both faces

`children` is never wrapped in a `Subscribable`. Its declared type passes through
untouched on **both** the caller face (`PropsIn<P>`) and the author face
(`Reactive<P>`). This is correct because reactive children already flow through
`JSXNode`'s own `Stream`/`Effect` arms: a `children: JSXNode` prop accepts a
static node _or_ a `Stream<JSXNode>` with no extra wrapping.

Narrowing `children` away from `JSXNode` forfeits those arms but still passes
raw — which is exactly what enables render-prop / headless patterns. The author
owns the render-prop protocol; the framework just passes the function through, so
a headless component can hand its child a `Subscribable<T>` of internal state:

```tsx
const Counter = Component.gen<{
  children: (count: Subscribable<number>) => JSXNode;
}>(function* (props) {
  const count = yield* makeCounter(); // Subscribable<number>
  return <div>{props.children(count)}</div>;
});

<Counter>{(count) => <span>{count.changes}</span>}</Counter>;
```

### Body errors are untyped (for now)

A `Component.gen` body's error channel is erased to `any` so the produced effect
fits `JSXNode`'s `E = never` arm (`any ⊑ never`). This erases the **entire**
channel, not just `NoPropValue`: any unhandled author error — a failing service
call, an unhandled `NoPropValue` from `.get` — surfaces as a fiber failure at the
enclosing region rather than a type error. Handling `.get` is therefore optional,
not forced. A typed body channel is a deliberate non-goal at this stage; it
arrives with the error boundary and the broader JSX error-signature rework.

### Render timing: `.get` parks, `.changes` streams

Because `.get` is await-first, reading a not-yet-emitted prop during body setup
**withholds the component's first render** until that prop emits: the renderer
places the region markers immediately and the content streams in once the value
arrives (under `<Suspense>`, the fallback shows until then). Binding `.changes` in
the returned JSX instead renders immediately and updates in place as the prop
emits.

- `yield* props.x.get` at the top → the component waits for `x`.
- `{props.x.changes}` in the output → renders now, fills in on emit.

(`.changes` completes after one value for static / `Effect`-sourced props, and is
infinite for `Stream`-sourced props.)

## Scope & Lifetime Model

A `Stream`-sourced prop owns a **pump fiber** (drains the source into a
`SubscriptionRef`). That fiber needs a lifetime owner — a `Scope` — and its
lifetime must equal the **component instance's** lifetime: it survives the
instance's internal region re-emissions but terminates the moment the instance
leaves the tree.

### Core requires only the standard `Scope`

`toSubscribable` forks its pump with `forkScoped`, so it requires the ambient
`Scope.Scope` service and nothing else. `@effect-ui/core` never references the
renderer's `RenderContext`; the renderer supplies the scope. The same
`toSubscribable` therefore works under any renderer that provides a `Scope`.

### The renderer provides a child scope per component instance

The active renderer (`@effect-ui/dom`) tracks the **current enclosing reactive
scope** and re-provides it as it descends the tree. There are exactly two
scope-forking boundaries:

- **Per component instance.** Entering a component, the renderer forks a child
  scope off the enclosing scope and provides it as the ambient `Scope` while
  running the component body. The body's prop pumps `forkScoped` into it, so they
  run **once** and live exactly as long as the instance.
- **Per dynamic region emission.** A stream-bound region (`cond ? <A/> : <B/>`)
  rotates a **content scope** per emission: before rendering the next value it
  closes the previous content scope, then forks a fresh one and renders into it.
  The region's _subscription_ fiber stays in the enclosing scope (it outlives any
  single emission); the per-emission subtree lives in the rotating content scope.

The forked scopes form a tree mirroring the component/region tree
(`mount ⊃ region-content ⊃ component ⊃ its-regions ⊃ …`), which yields:

- **Transitive teardown** — closing any scope (a region re-emitting, or full
  unmount) interrupts every descendant pump and nested region fiber in one shot.
- **Eager cleanup** — rotating the content scope per emission means a region that
  emits N times holds only the live subtree's scopes, never N dead ones.

### Renderer-provided capabilities are distinct from app requirements

The `Scope` a component body requires is **renderer-provided** — discharged per
instance by the renderer, not declared by the app author. It is kept distinct
from app-service requirements (the `JSXRequirements` channel): the JSX return
contract permits a `Scope` requirement (`… | Scope`) that the renderer satisfies,
while app services remain the author's to provide. This seam keeps a future
rework of `JSXRequirements` from entangling with renderer-injected scope.

## Public API

- `Component.gen<P>(body)` — define a component from a generator body:

  ```ts
  Component.gen: <P>(
    body: (props: Reactive<P>) => Generator<
      YieldWrap<Effect.Effect<any, any, JSXRequirements | Scope.Scope>>,
      JSXNode,
      never
    >,
  ) => Component<P>
  ```

  `P` is the **raw** prop shape, written once as the **sole** type argument. The
  body receives `Reactive<P>` (the inside view) and returns a `JSXNode`; it may
  `yield*` Effects whose requirements are within `JSXRequirements | Scope`. The
  result is branded `Component<P>` so JSX can derive the caller view.

  Unlike `Effect.gen`, the body's effect type is **not captured** as a second
  type parameter: the body channel is erased to `any` (see _Body errors are
  untyped_) and requirements are fixed to `JSXRequirements | Scope`, so the
  result is always `Component<P>`. The yielded-effect type is therefore a bare
  **constraint** on the generator, not an inferred parameter. This is deliberate:
  TypeScript has no partial type-argument inference, so a second (inferred) param
  would force the caller to spell out _both_ arguments — `P` cannot be inferred
  from the body (the `props` parameter is never annotated), making the documented
  single-argument call `Component.gen<{ name: string }>(body)` impossible. Pinning
  `P` as the only explicit argument keeps that call shape sound.

- `toSubscribable<A>(source, key?)` — normalize one caller-facing value into an
  await-first, hot `Subscribable`:

  ```ts
  toSubscribable: <A>(source: Source<A>, key?: string) =>
    Effect.Effect<Subscribable.Subscribable<A, NoPropValue>, never, Scope.Scope>;
  ```

  Forks a scoped pump fiber only for `Stream` sources; identity for an existing
  `Subscribable`; cheap for static / `Effect`. The optional `key` is carried on
  `NoPropValue`; `Component.gen` supplies each prop's key while normalizing.

- `NoPropValue` — tagged error (`_tag: "NoPropValue"`) carrying the offending
  prop `key`, raised by `get` when a stream source ends without emitting.

- `isSubscribable` — re-exported from Effect; reliable guard keyed off
  Subscribable's `TypeId`.

### Types

- `Reactive<P>` — the inside (author-facing) view of props. Each non-`children`
  slot becomes `Subscribable<P[K], NoPropValue>`; `children` passes through:

  ```ts
  type Reactive<P> = {
    readonly [K in keyof P]: K extends "children"
      ? P[K]
      : Subscribable.Subscribable<P[K], NoPropValue>;
  };
  ```

- `PropsIn<P>` — the caller-facing view of props. Each non-`children` slot widens
  to `Source<P[K]>`; `children` passes through:

  ```ts
  type PropsIn<P> = {
    [K in keyof P]: K extends "children" ? P[K] : Source<P[K]>;
  };
  ```

- `Component<P>` — a branded component. The call signature matches runtime
  (caller props in, the gen's effect out); the `[RawProps]` brand carries `P` and
  is what `JSX.LibraryManagedAttributes` reads to reconstruct the caller view
  (the call signature is _not_ used for that inference):

  ```ts
  interface Component<P> {
    (props: PropsIn<P>): Effect.Effect<JSXNode, any, JSXRequirements | Scope.Scope>;
    readonly [RawProps]?: P;
  }
  ```

- `PropsOf<C>` — extracts the raw prop shape `P` a `Component` was defined with.

- `Source<T>` — `T | Stream<T> | Effect<T> | Subscribable<T>` (caller
  vocabulary, `types/index.ts`). The `Stream`/`Effect` arms are pinned to `never`
  error / requirements for now (widening is part of the deferred JSX-signature
  rework).

## Acceptance Criteria

1. **AC-1 raw shape written once** — `Component.gen<{ name: string }>(body)` types
   `props.name` as `Subscribable<string, NoPropValue>` inside `body` with no
   annotation on the `props` parameter. A declared `children` slot appears on the
   author face with its declared type, **not** wrapped in a `Subscribable`.
2. **AC-2 caller widening** — JSX `<C name={x} />` type-accepts `x` as `string`,
   `Stream<string>`, `Effect<string>`, and `Subscribable<string>`; rejects
   unrelated types. `children` is **not** widened — it is accepted with its
   declared type (no `Source`).
3. **AC-3 static normalization** — `toSubscribable("x")`: `get` succeeds with
   `"x"` immediately; `changes` emits `"x"` once; never `NoPropValue`; forks no
   fiber.
4. **AC-4 effect normalization** — `toSubscribable(effect)`: underlying effect
   runs **once** (memoized) regardless of how many times `get`/`changes` are
   consumed; `changes` emits the resolved value once.
5. **AC-5 stream await-first (latest)** — after the source has emitted,
   `get` returns the **most recent** value without awaiting.
6. **AC-6 stream await-first (pending)** — before the source has emitted, `get`
   parks and resolves with the first emitted value.
7. **AC-7 stream ends empty** — if the source completes without ever emitting,
   a pending `get` fails with `NoPropValue` (carrying the prop key) rather than
   hanging forever.
8. **AC-8 hot/shared** — multiple consumers of one normalized prop observe the
   same emissions and the source runs once (no re-subscription per consumer).
9. **AC-9 identity pass-through** — `toSubscribable(sub)` for an existing
   `Subscribable` returns that same reference (no new ref/fiber).
10. **AC-10 instance lifetime** — a component instance's prop pump fibers
    terminate when that instance's scope closes, and survive the instance's
    internal region re-emissions (the body runs once; its dynamic regions
    re-emit without tearing down the instance).
11. **AC-11 renderer-agnostic scope** — `toSubscribable` requires only the
    ambient `Scope.Scope` service (never `RenderContext`); its pump is satisfied
    by whatever scope the renderer provides for the instance.
12. **AC-12 prompt teardown on removal** — when a component is removed from the
    DOM by a dynamic region swap, its prop pumps are interrupted at that point,
    not deferred to full unmount.
13. **AC-13 no accumulation across emissions** — a dynamic region that renders N
    successive subtrees retains only the live subtree's scopes; each prior
    content scope is closed on the next emission.
14. **AC-14 transitive teardown** — closing an ancestor scope (region re-render
    or unmount) interrupts all descendant component pumps and nested region
    fibers in one shot.
15. **AC-15 children render-prop** — a `children: (s) => JSXNode` prop passes
    through raw on both faces: the caller supplies the function as-is, and the
    body receives it callable (no `Subscribable` wrapping, no `Source`
    widening).
16. **AC-16 honest signature** — calling a `Component<P>` directly
    (`MyComp(callerProps)`) type-accepts `PropsIn<P>` and yields a `JSXNode` (an
    `Effect<JSXNode, …>`); JSX usage is unaffected because
    `LibraryManagedAttributes` reads the `[RawProps]` brand, not the call
    signature.

> AC-12 through AC-14 are realized by the renderer (`@effect-ui/dom`); they are
> specified here because they define the lifetime contract `toSubscribable`
> relies on.
