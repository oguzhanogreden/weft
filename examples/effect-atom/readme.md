# effect-atom (External State Library Integration)

> **⚠️ Temporarily excluded from the workspace (Effect 4 migration).**
> `@effect-atom/atom` has no Effect-4-compatible release yet — its latest
> version (`0.5.3`) depends on `effect@^3`. This example is excluded from
> `pnpm-workspace.yaml` (`!examples/effect-atom`) so it does not break the
> workspace's Effect 4 build. **TODO:** re-include and migrate once
> `@effect-atom/atom` ships an Effect 4 build.

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

**Gotcha — the registry must outlive the mount effect.** Atom subscriptions are fibers forked for the lifetime of the app, not the lifetime of `mount(...)`. `Registry.layer` is a `Layer.scoped`, and `mount`'s effect resolves right after initial render — not when the app stops running — so providing the layer directly around `mount` releases the registry the instant that effect settles, while every subscription keeps reading from it:

```typescript
// ❌ the registry is disposed the moment mount resolves — every atom
// subscription then reads from a released registry
Effect.runPromise(mount(App(), root).pipe(Effect.provide(Registry.layer)));
```

`main.ts` avoids this with the composable-mount-lifetime pattern: provide `Registry.layer` **outside** a long-lived scoped region, and mount inside that region with `mountScoped`, which registers `unmount` as a finalizer on the region's scope instead of tying the registry's lifetime to the mount effect's resolution. `Effect.never` keeps the region — and therefore the registry — open for the app's lifetime, and `runFork` drives it since the program never settles on its own:

```typescript
import { Registry } from "@effect-atom/atom";
import { mountScoped } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const program = Effect.scoped(
  Effect.gen(function* () {
    yield* mountScoped(App(), document.getElementById("root")!);
    yield* Effect.never;
  }),
).pipe(Effect.provide(Registry.layer));

Effect.runFork(program);
```

The co-located `app.browser.test.ts` follows the same composition per test, swapping `Effect.never` for `Deferred.await(shutdown)` so each test can request teardown explicitly: `afterEach` succeeds the `shutdown` deferred and joins the fiber, which closes the scoped region (running `mountScoped`'s `unmount` finalizer) and only then releases `Registry.layer` — isolating atom state between test cases without a manual `Registry.make()`/`dispose()` pair.

See [Provide Services](../../docs/how-to/provide-services.md) for this composition as a general recipe, and [Layer lifetime at the mount](../../docs/explanation/services-and-context.md#layer-lifetime-at-the-mount) for why the mount effect resolving early matters here.

## When to Use

- You already use effect-atom (or are adopting it) and want to drive a Weft UI from it without writing a bridge layer.
- You need derived/computed state (`Atom.map`) beyond what a single `SubscriptionRef` conveniently expresses.
- You need async state with built-in loading/success/failure/refresh semantics (`Result`, `Atom.refresh`) rather than modeling that by hand over a `Stream`.
- You need a registry that can be swapped, scoped per-test, or shared across multiple mounted trees independently of any single component's lifetime.
