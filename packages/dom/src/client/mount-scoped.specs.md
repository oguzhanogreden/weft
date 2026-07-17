# Scope-aware mount / hydrate

## Overview & Purpose

`mount`/`hydrate` (`render.ts`) capture the ambient Effect context into a
per-mount `ManagedRuntime` that serves stream subscriptions and event handlers
until `unmount`. But the mount effect **resolves right after initial render**, so
a scoped layer provided the obvious way —

```ts
Effect.runPromise(mount(App(), root).pipe(Effect.provide(SomeScopedLayer)));
```

— has its finalizers run the moment `runPromise` settles. The app then keeps
running against **disposed services**: with effect-atom's `Registry.layer`, every
reactive region renders empty with zero console output (companion issue #122,
fixed in PR #125). The current `examples/effect-atom` works around this with a
manual `Registry.make()` + `Effect.provideService`.

This feature makes the mount lifetime composable with Effect's scoped resource
management, so a scoped layer can outlive initial render and be released
deterministically at teardown.

Two additive, complementary mechanisms:

1. **Scope-aware variants** `mountScoped` / `hydrateScoped` — identical to their
   plain counterparts, but require an ambient `Scope.Scope` in `R` and register
   `unmount` as a finalizer on it. The mount lives until the ambient scope closes.
2. **Hardening** of plain `mount` / `hydrate` — when an ambient `Scope.Scope` is
   present in context, auto-register `unmount` on it. No ambient scope → behavior
   unchanged. Signatures unchanged.

The recommended composition provides the scoped layer **outside** a long-lived
scoped region so the layer lives for the app's lifetime, not just initial render:

```ts
const program = pipe(
  Effect.scoped(
    Effect.gen(function* () {
      yield* mountScoped(App(), root);
      yield* Effect.never; // or: yield* Deferred.await(shutdown)
    }),
  ),
  Effect.provide(AppLive), // OUTSIDE the scoped region — lives until region ends
);
const fiber = Effect.runFork(program); // runFork, NOT runPromise (Effect.never never settles)
// later: Effect.runPromise(Fiber.interrupt(fiber));
// teardown order: unmount (inner scope close) → AppLive release
```

## Acceptance Criteria

- [ ] **AC-S1:** `mountScoped(app, root)` returns the same `MountHandle` as
      `mount`, with `Scope.Scope` added to the effect's `R` channel and the error
      union `UnsupportedNodeTypeError | StreamSubscriptionError | RenderError`.
- [ ] **AC-S2:** When the ambient scope closes, the mount is unmounted —
      subscriptions interrupted, runtime disposed. DOM nodes are **not** removed
      from `root` (documented; scoped variants inherit plain `unmount` semantics).
- [ ] **AC-S3:** A scoped layer provided **outside** the scoped region stays alive
      across stream emissions and event-handler invocations for the whole app
      lifetime (its release does not run at mount-resolve).
- [ ] **AC-S4:** Teardown ordering — inner-scope `unmount` runs **before** the
      outer provided layer's release.
- [ ] **AC-S5:** Manual `handle.unmount()` followed by ambient-scope close is a
      no-op the second time (idempotent); teardown side-effects fire once.
- [ ] **AC-S6:** On render failure, no finalizer is registered and nothing leaks
      (the existing AC28 mount-failure cleanup runs; the `Effect.tap` finalizer is
      registered only on success).
- [ ] **AC-S7:** `hydrateScoped` preserves the `AssertNoServerOnly` → `ServerOnlyLeak`
      compile-time guard, with `Scope.Scope` added to `R`; its error union adds
      `HydrationMismatchError`.
- [ ] **AC-S8:** `mount` / `hydrate` public signatures are unchanged (`R` stays
      `never`); with no ambient scope in context, behavior is identical to today
      (existing dom / hydrate suites stay green).
- [ ] **AC-S9 (hardening):** Plain `mount` / `hydrate` invoked inside a region that
      supplies an ambient `Scope.Scope` auto-register `unmount` on that scope.
- [ ] **AC-S10 (unmount owns forked work):** Scoped work forked from an event
      handler (e.g. `Effect.forkScoped`, `acquireRelease`) attaches to the mount's
      **internal** scope, not to a caller's ambient `Scope.Scope`, so
      `handle.unmount()` interrupts it. The event-handler runtime is built with
      `Scope.Scope` overridden to the internal scope; without this override,
      handler-forked scoped fibers bound to an outer region survive `unmount` and
      leak until that region closes.

## Technical Requirements

- New file `packages/dom/src/client/mount-scoped.ts` — pure composition over the
  public `mount`/`hydrate`; no renderer internals (keeps `render.ts` from growing).
- `mountScoped`: `pipe(mount(app, root), Effect.tap(handle => Effect.addFinalizer(() => handle.unmount())))`.
- `hydrateScoped`: overload mirrors `render.ts` `hydrate` (`AssertNoServerOnly`
  tuple conditional), only `R` changes `never` → `Scope.Scope`; body pipes
  `hydrate` through the same `Effect.tap(addFinalizer)`.
- Hardening in `render.ts` `mount`/`hydrate` gen bodies: at top of body (caller
  context) `const ambientScope = yield* Effect.serviceOption(Scope.Scope)`; after
  the handle is built, `if (Option.isSome(ambientScope)) yield* Scope.addFinalizer(ambientScope.value, handle.unmount())`.
- Re-export from `packages/dom/src/client/index.ts`.
- With hardening in place, `mountScoped`'s explicit `addFinalizer` double-registers
  when an ambient scope exists — harmless: the `unmounted` flag makes the second
  finalizer a no-op. Kept explicit so the typed variant does not silently depend on
  the hardening.

## Dependencies & Integrations

- Imports: `mount` / `hydrate` / `MountHandle` from `./render`; errors from `~/data`;
  `AssertNoServerOnly` / `ServerOnlyLeak` / `Node` / `Renderable` from `@weftui/core`.
- Effect semantics: `Effect.provide(scopedLayer)` releases the layer when
  the **wrapped effect completes** (acquireUseRelease) — hence `provide` must wrap a
  long-lived scoped region (`Effect.never` / `Deferred.await`), and `runFork` (not
  `runPromise`) drives it.
- Cross-references `dom.specs.md` AC26 (Unmount Function) / AC27 (Mount Return
  Value): the auto-scope registration reuses the same idempotent `handle.unmount()`
  and does not change those contracts.

## Expected Behavior & Edge Cases

- Captured `Effect.context<never>()` includes the caller's `Scope.Scope` when
  mounting inside a scoped region. The render walk already provides the internal
  scope to `renderNode`, but the **event-handler runtime** is built from the
  captured context — so `mount`/`hydrate` now override `Scope.Scope` to the
  internal scope in that runtime's context (`Context.add(effectContext, Scope.Scope, scope)`).
  This makes handler-forked scoped work (`forkScoped`, `acquireRelease`) owned by
  `unmount` (AC-S10). Only `Scope.Scope` is overridden; all other captured
  services are preserved.
- Idempotent unmount (existing `unmounted` flag) guarantees double-registration
  and manual-then-scope-close are both safe.
- `unmount` interruption stays silent (`forkSupervised`, PR #125) — both new paths
  reuse `handle.unmount()` verbatim, preserving that guarantee.

## e2e

Applicable and done (browser-observable: real event dispatch + scoped-layer
lifetime):

- `mount-scoped.browser.test.ts` — issue #123 acceptance criterion with a
  hand-rolled `Layer.effect` + `acquireRelease` counter service driven by `runFork` + `Deferred`
  shutdown: acquired once, alive across real clicks, released only at scope close,
  no DOM patch post-shutdown.
- `examples/effect-atom/app.browser.test.ts` — reworked to the scoped composition
  (`Registry.layer` outside a `Deferred`-gated region); all behavioral tests kept
  plus one asserting updates flow across interactions then stop after shutdown.

Note: package browser tests import the **built** `@weftui/dom/client` (not the
`./mount-scoped` source) — the flat `vitest.browser.config.ts` does not resolve
the package's `~/*` path aliases that `render.ts` uses. `vp run test:browser`
passes on vite-plus 0.2.2 without the 0.2.1 direct-`vitest` workaround.

## Rejected Alternatives

- Making `mount` **require** `Scope.Scope` in `R` — breaking change to every
  existing caller; rejected in favor of additive variants + opt-in hardening.
- **Corrected during /review-step:** an earlier draft claimed the captured
  `Scope.Scope` was "harmless — the render walk overrides it" and did not need
  sanitizing. A review finding + a verifying test disproved this: the render-walk
  override covers only `renderNode`, not the event-handler runtime, so
  handler-forked scoped work bound to a caller's ambient scope leaked past
  `unmount`. The implementation now **does** override `Scope.Scope` to the internal
  scope in the handler runtime's context (see AC-S10) — a targeted override of one
  service, not a wholesale sanitize of the captured context.

## Type-level surface

Meaningful — `hydrateScoped` carries the `AssertNoServerOnly` conditional and the
`Scope.Scope` requirement. `/type-tests` applies (see AC-S1, AC-S7).

## Pre-existing baseline note (discovered during /type-tests)

On `fix/123-scope-aware-mount` (== origin/main), `vp run check` is **already red**
with 9 errors in `examples/effect-atom`, all pre-dating this work:

- `app.ts` ×6 — `Atom.toStream(...)` TS2769 (no overload matches) — `@effect-atom/atom`
  API drift; the current call shape is stale.
- `main.ts` ×1 + `app.browser.test.ts` ×2 — `Registry.AtomRegistry` /
  `registry.dispose()` TS2345 — same drift, plus the manual-registry workaround this
  feature is meant to replace.

_(Historical — pre-Effect-4. `@effect-atom/atom` and the pnpm override below were
removed in the Effect 4 migration; the workspace now tracks the Effect 4 beta
line and the atom APIs come from `effect/unstable/reactivity`.)_

**Root cause + fix (resolved in /implement):** all 9 errors were a single
dual-`effect`-instance skew — `@effect-atom@0.5.3` resolved `effect@3.21.3` in its
subtree while the workspace catalog pins `effect@3.21.4`, so the branded
`[StreamTypeId]`/`[EffectTypeId]` symbols differed (TS2769 "no overload" on the
`h.*`/`onclick` calls, TS2739 "missing [StreamTypeId]" on the test). A pnpm
`overrides: { effect: "3.21.4" }` in root `package.json` dedupes to one instance;
after `vp install` the example typechecks unchanged (`app.ts` needed **no** code
change). `vp run check` is fully green post-dedupe. The `main.ts` scoped-pattern
rewrite + browser-test rework proceed in `/e2e` as an example refresh (not an
error fix).
