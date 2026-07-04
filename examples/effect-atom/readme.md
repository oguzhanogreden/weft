# effect-atom (External State Library Integration)

## Overview

This example demonstrates driving a Weft UI from [effect-atom](https://github.com/tim-smart/effect-atom), an external Effect-native state management library (`@effect-atom/atom`). It shows a writable atom, a derived atom, and an async atom rendered through its `Result` states.

## Problem

Applications often need a state library with more structure than a bare `SubscriptionRef` — derived/computed atoms, async atoms with loading and refresh semantics, and a registry that can be shared, tested, or torn down independently of the UI. Reaching for such a library usually means writing an adapter layer to bridge its subscription model into the UI's reactivity model.

## Solution

effect-atom needs no adapter here because both libraries speak Effect. `Atom.toStream` turns an atom into a `Stream`, which Weft already consumes natively as a child or prop; `Atom.update` and `Atom.refresh` return Effects, which Weft event handlers already run on the mount runtime.

```typescript
import { Atom, Result } from "@effect-atom/atom";
import { h } from "@weftui/core";
import { Effect, Stream } from "effect";

const countAtom = Atom.make(0);
const doubleAtom = Atom.map(countAtom, (n) => n * 2);

const Counter = () =>
  h.div([
    h.p(["Count: ", h.strong([Atom.toStream(countAtom)])]),
    h.p(["Doubled: ", h.span([Atom.toStream(doubleAtom)])]),
    h.button({ onclick: () => Atom.update(countAtom, (n) => n + 1) }, "+"),
  ]);
```

## How It Works

1. `Atom.make(initial)` creates a writable atom; `Atom.map(atom, fn)` derives a read-only atom that recomputes whenever its source changes. State lives in the `AtomRegistry`, not the component — atoms are defined at module scope.
2. `Atom.toStream(atom)` subscribes with `immediate: true` and returns a `Stream<A, never, AtomRegistry>` that emits the current value right away, then every subsequent change. Passed directly into `h.*` as a child or prop, Weft renders it like any other stream.
3. `Atom.update(atom, fn)` and `Atom.refresh(atom)` return Effects requiring `AtomRegistry`. An `onclick` handler that returns one of these Effects is run on the mount runtime, which carries whatever services were provided around `mount(...)` — no manual `Effect.runPromise` inside the handler.
4. Async atoms wrap an Effect (e.g. `Atom.make(Effect.gen(...))`) and expose their state as a `Result`. `Result.match` maps `onInitial` / `onFailure` / `onSuccess` to renderable values; the `waiting` flag on a `Success` result distinguishes an already-loaded value from one currently being refreshed via `Atom.refresh`, so the UI can show "Reloading…" instead of flashing back to a loading state.

**Gotcha — the registry must outlive the mount effect.** Atom subscriptions are fibers forked for the lifetime of the app, not the lifetime of `mount(...)`. `Registry.layer` is a `Layer.scoped`: providing it directly to the mount effect disposes the registry the instant `mount` resolves, and every subscription then dies — silently, unless a `Boundary` happens to catch it — because the registry is disposed. `main.ts` avoids this by creating the registry manually and providing it as a plain service value instead of a layer:

```typescript
import { Registry } from "@effect-atom/atom";
import { mount } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const registry = Registry.make();

void Effect.runPromise(
  mount(App(), document.getElementById("root")!).pipe(
    Effect.provideService(Registry.AtomRegistry, registry),
  ),
);
```

The co-located `app.browser.test.ts` follows the same pattern per test: a fresh `Registry.make()` before mounting, isolating atom state between test cases, with `registry.dispose()` called in `afterEach` alongside `handle.unmount()`.

## When to Use

- You already use effect-atom (or are adopting it) and want to drive a Weft UI from it without writing a bridge layer.
- You need derived/computed state (`Atom.map`) beyond what a single `SubscriptionRef` conveniently expresses.
- You need async state with built-in loading/success/failure/refresh semantics (`Result`, `Atom.refresh`) rather than modeling that by hand over a `Stream`.
- You need a registry that can be swapped, scoped per-test, or shared across multiple mounted trees independently of any single component's lifetime.
