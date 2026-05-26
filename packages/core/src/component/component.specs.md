# `@effect-ui/core` — Component Definition & Prop Normalization

## Overview

`component()` defines a component from a render function. It exists to make the
two faces of a prop type magically asymmetric:

- **Caller / JSX side** — every slot accepts `MaybeReactive<T>`, so a prop
  declared `name: string` accepts `"x"`, `Stream<string>`, `Effect<string>`, or
  an existing `Subscribable<string>` interchangeably.
- **Author / inside side** — the render function receives the same props mapped
  to `Subscribable<T>`: read-only handles that expose both a live stream
  (`.changes`) and an await-first current value (`.get`).

The author writes the raw prop shape **once** (as the `component()` type
argument); both faces are derived from it.

## Purpose

A component declared as

```tsx
const Greeting = component<{ name: string }>((props) => {
  // props.name: Subscribable<string>
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

`toSubscribable` is the runtime glue that normalizes each incoming
`MaybeReactive<T>` value into one uniform await-first `Subscribable<T>` that the
framework assembles into the `Reactive<P>` object handed to the render function.

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
`MaybeReactive`. Await-first removes the race; waiting is visible in the types
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

`MaybeReactive<T>` includes `Subscribable<T>`, and `toSubscribable`
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

## Public API

- `component<P>(render: (props: Reactive<P>) => JSXNode): Component<P>` — define
  a component from a render function. `P` is the **raw** prop shape, written
  once; `Reactive<P>` is the inside view, `Component<P>` carries `P` so JSX can
  derive the caller view.
- `toSubscribable<A>(source: MaybeReactive<A>): Effect.Effect<Subscribable<A, NoPropValue>, never, Scope>`
  — normalize one caller-facing value into an await-first, hot `Subscribable`.
  Forks a scoped pump fiber only for `Stream` sources; identity for an existing
  `Subscribable`; cheap for static / `Effect`.
- `NoPropValue` — tagged error (`_tag: "NoPropValue"`) carrying the offending
  prop `key`, raised by `get` when a stream source ends without emitting.
- `isSubscribable` — re-exported from Effect; reliable guard keyed off
  Subscribable's `TypeId`.

### Types

- `Reactive<P>` — `{ readonly [K in keyof P]: Subscribable<P[K]> }`. The inside
  (author-facing) view of props.
- `Component<P>` — branded `(props: Reactive<P>) => JSXNode` carrying raw `P` so
  `JSX.LibraryManagedAttributes` can map back to the caller view.
- `MaybeReactive<T>` — widened to
  `T | Stream<T> | Effect<T> | Subscribable<T>` (caller view, `types/index.ts`).

## Acceptance Criteria

1. **AC-1 raw shape written once** — `component<{ name: string }>(render)` types
   `props.name` as `Subscribable<string>` inside `render` with no annotation on
   the `props` parameter.
2. **AC-2 caller widening** — JSX `<C name={x} />` type-accepts `x` as `string`,
   `Stream<string>`, `Effect<string>`, and `Subscribable<string>`; rejects
   unrelated types.
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
10. **AC-10 lifetime** — the pump fiber terminates when the originating
    component's scope closes.
