---
title: Provide Services
order: 12
section: how-to
description: Provide plain and scoped Layers to a mounted app — the direct mount for value layers, mountScoped plus a shutdown signal for scoped layers, and a ManagedRuntime as an alternative.
---

# Provide Services

**Goal:** provide a `Layer` to the mounted app so its components can read services with `yield* Service`.

Which recipe to reach for depends on whether the layer has anything to release. A plain value layer (`Layer.succeed`, `Layer.effect` with no `acquireRelease`) can be provided directly at the mount — there is nothing to leak. A **scoped** layer (`Layer.scoped`, anything backed by `acquireRelease`) needs the mount to outlive the effect's own resolution — see [Layer lifetime at the mount](../explanation/services-and-context.md#layer-lifetime-at-the-mount) for why.

## Recipe 1 — plain value layers with `mount`

Provide the layer directly around `mount` and run with `runPromise`. This is the common case and needs nothing else.

```typescript
import { mount } from "@weftui/dom/client";
import { Effect, pipe } from "effect";
import { App } from "./app";
import { ThemeServiceLive } from "./theme-service";

const root = document.getElementById("root")!;

const program = pipe(mount(App(), root), Effect.provide(ThemeServiceLive));

Effect.runPromise(program);
```

## Recipe 2 — scoped layers with `mountScoped`

Provide the scoped layer **outside** a long-lived scoped region, mount inside that region with `mountScoped`, and keep the region open with `Effect.never` or `Deferred.await` on a shutdown signal. Drive the whole thing with `runFork`, not `runPromise` — the program never settles on its own.

```typescript
import { mountScoped } from "@weftui/dom/client";
import { Deferred, Effect, Fiber, pipe } from "effect";
import { App } from "./app";
import { AppLive } from "./app-live";

const root = document.getElementById("root")!;

const program = pipe(
  Effect.scoped(
    Effect.gen(function* () {
      yield* mountScoped(App(), root);
      yield* Effect.never; // keeps the region — and AppLive — alive
    }),
  ),
  Effect.provide(AppLive), // OUTSIDE the scoped region: outlives initial render
);

const fiber = Effect.runFork(program);

// later, e.g. on a "sign out" action or test teardown:
// await Effect.runPromise(Fiber.interrupt(fiber));
```

Interrupting `fiber` closes the inner scope first — running `mountScoped`'s finalizer, which calls `unmount` — and only then releases `AppLive`. Swap `Effect.never` for `Deferred.await(shutdown)` when something in the app should be able to request shutdown itself:

```typescript
const shutdown = await Effect.runPromise(Deferred.make<void>());

const program = pipe(
  Effect.scoped(
    Effect.gen(function* () {
      yield* mountScoped(App(), root);
      yield* Deferred.await(shutdown); // resolves when shutdown is signalled
    }),
  ),
  Effect.provide(AppLive),
);
Effect.runFork(program);

// elsewhere, to request shutdown:
// await Effect.runPromise(Deferred.succeed(shutdown, undefined));
```

`hydrateScoped` is the SSR counterpart — same composition, swap `mountScoped` for `hydrateScoped`.

## Recipe 3 — `ManagedRuntime` with plain `mount`

Build a `ManagedRuntime` from the scoped layer and mount with plain `mount`, running through the runtime instead of `Effect.runPromise` directly. The layer lives until `runtime.dispose()` — an explicit call, rather than a scope closing.

```typescript
import { mount } from "@weftui/dom/client";
import { ManagedRuntime } from "effect";
import { App } from "./app";
import { AppLive } from "./app-live";

const root = document.getElementById("root")!;
const runtime = ManagedRuntime.make(AppLive);

await runtime.runPromise(mount(App(), root));

// later:
// await runtime.dispose();
```

This reads closer to Recipe 1 at the call site and is a good fit when the surrounding app (a framework integration, a test harness) already manages a runtime's lifecycle for you.

## Anti-patterns

Both of these compile and both dispose the scoped layer while the app is still running — the mounted tree keeps its subscriptions and handlers, but they now read from a released service.

```typescript
// ❌ plain mount: the layer releases the instant runPromise settles
Effect.runPromise(mount(App(), root).pipe(Effect.provide(SomeScopedLayer)));
```

```typescript
// ❌ mountScoped, but the scoped region closes as soon as the mount effect
// resolves — nothing keeps it open, so this is no better than plain mount
Effect.runPromise(mountScoped(App(), root).pipe(Effect.provide(SomeScopedLayer), Effect.scoped));
```

In both cases the tell is the same: nothing in the composition keeps a scope open past the point where the mount Effect itself resolves. Recipe 2's `Effect.never` (or `Deferred.await`) is doing the one piece of work these anti-patterns are missing.

## See also

- [Layer lifetime at the mount](../explanation/services-and-context.md#layer-lifetime-at-the-mount) — why the mount effect resolving early matters for scoped layers
- [Services and Context](../explanation/services-and-context.md) — how `R` accumulates and discharges at the mount
- [`mountScoped` / `hydrateScoped` reference](../reference/dom.md#mountscoped) — signatures and error unions
- [examples/effect-atom](../../examples/effect-atom) — a real scoped layer (`Registry.layer`) mounted with this composition
