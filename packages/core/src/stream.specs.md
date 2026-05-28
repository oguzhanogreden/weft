# `@effect-ui/core` — Stream Normalization (`toStream`)

## Overview

A single normalization helper, `toStream`, plus its supporting type guard
`isStream`. Together they collapse the three caller-facing prop shapes
(static value, `Effect`, `Stream`) into one uniform `Stream`, so renderer and
component code can subscribe without branching. `toStream` is the effect-ui
equivalent of Vue's `unref`.

## Purpose

Components accept reactive inputs typed `Source<T>` (see
`types/index.ts`). The renderer already auto-subscribes to a `Source<T>`
dropped straight into a slot. `toStream` exists for the remaining case: when an
author wants to **compute with** a prop internally (derive, branch) rather than
forward it, they normalize once and stay in `Stream`-land:

```ts
pipe(
  toStream(props.title),
  Stream.map((t) => t.toUpperCase()),
);
```

## Public API

- `isStream(value): value is Stream.Stream<unknown, any, any>` — type guard for
  Effect `Stream` values. Uses `any` for `E`/`R` so it matches any stream.
- `toStream<A>(value: A | Effect.Effect<A> | Stream.Stream<A>): Stream.Stream<A>`
  — normalizes to a `Stream`.

## Consumption Vocabulary (guidance)

| Need                         | What to do                                                                               | New API?             |
| ---------------------------- | ---------------------------------------------------------------------------------------- | -------------------- |
| Render a `Source` prop       | Pass `props.x` straight into JSX — renderer auto-subscribes                              | none                 |
| Derive / compute internally  | `pipe(toStream(props.x), Stream.map(…))`                                                 | `toStream`           |
| Read current value / two-way | Type the prop `Subscribable<T>` / `SubscriptionRef<T>`; use `.get` / `.changes` / `.set` | none (Effect stdlib) |
| Output / event               | Plain callback prop `(v) => void \| Effect<void>`                                        | none                 |

**One-way by default (convention, not enforced):** model inputs as
`Source<T>` and outputs as callbacks. `Ref`/`SubscriptionRef` already
encapsulate safe, controlled mutation, so passing one to a child for two-way
flow is legitimate capability-passing — reach for it deliberately, not by
default. The framework enforces nothing.

## Acceptance Criteria

1. **AC-1 static** — `toStream(value)` for a non-Effect, non-Stream value emits
   exactly that value once (equivalent to `Stream.make(value)`).
2. **AC-2 effect** — `toStream(effect)` produces a one-shot stream emitting the
   Effect's success value.
3. **AC-3 stream passthrough** — `toStream(stream)` returns the same stream
   instance unchanged (`isStream` short-circuit).
4. **AC-4 isStream** — `isStream` returns `true` for streams and `false` for
   plain values, Effects, `null`, and non-objects.
5. **AC-5 single source of truth** — `isStream`/`toStream` are defined only in
   `@effect-ui/core`; no duplicate definitions remain in `@effect-ui/dom`.
6. **AC-6 Source** — `Source<T>` (renamed from `Prop<T>`) accepts
   static `T`, `Stream<T>`, and `Effect<T>` and is the documented caller-facing
   prop vocabulary.
