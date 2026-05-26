# Plan — Component Definition & Prop Normalization (`Component.gen`)

> Companion spec: `packages/core/src/component/component.specs.md`

## Context

`@effect-ui/core` needs a component boundary where a prop shape `P` wears two faces:
the **caller/JSX side** accepts `MaybeReactive<T>` (a static `T`, `Stream<T>`,
`Effect<T>`, or `Subscribable<T>`), and the **author side** receives `Reactive<P>`
— every slot a `Subscribable<T, NoPropValue>` handle exposing `.changes` (live
stream) and `.get` (await-first current value).

After an extended design discussion we settled the shape below. The headline
reason for the factory (vs. authors hand-normalizing) is that it **erases the
static↔reactive distinction at the author boundary**: switching a caller from a
literal to a stream never forces edits inside the component (the Vue
`ref`/`unref` tax is abolished). Enforcement is a privilege of the factory's
brand; plain functions stay what-you-see-is-what-you-get and remain the escape
hatch for composables.

## Locked decisions

1. **Single factory: `Component.gen<P>(body)`** — no plain `component()`. The body
   is an `Effect.gen`-style generator receiving `Reactive<P>` and returning a
   `JSXNode`; it may `yield*` Effects (including `props.x.get`).
2. **`toSubscribable` is eager-scoped** — `Effect<Subscribable<A, NoPropValue>, never, Scope>`,
   forks its pump with `forkScoped` (requires the ambient `Scope.Scope` service).
   `.get` (and the `Subscribable` handle) are therefore only reachable inside a
   generator body. `toStream` (existing, synchronous) remains for plain
   arrows / composables that only need a stream, no current value.
3. **Caller widening is brand-only** — only values branded `Component<P>` get the
   per-slot `MaybeReactive` widening; plain function components are passed props
   as authored.
4. **`toSubscribable(source, key?)`** — the optional `key` is carried on
   `NoPropValue`; `Component.gen` supplies each prop's key while normalizing.
5. **`Reactive<P>` exempts `children`** — children pass through as-is (renderable
   nodes), not wrapped in a `Subscribable`.
6. **`JSXNode` reactive arms advertise `Scope`** — widened to
   `... , JSXRequirements | Scope.Scope`, so a gen body's returned effect (which
   requires the renderer-provided `Scope`) is a valid `JSXNode`.
7. **Body error channel is unconstrained (`any`)** — relies on `any ⊑ never` so
   the produced `Effect<JSXNode, any, …>` still fits `JSXNode`'s `E = never` arm.
   Unhandled author errors (incl. an unhandled `NoPropValue` from `.get`) surface
   as a fiber failure at the enclosing region — the seam a future error boundary
   plugs into. Handling `.get` is optional, not forced.
8. **Per-component child scopes in the renderer** — core requires only the
   standard `Scope`; the renderer (`@effect-ui/dom`) supplies a child scope per
   component instance and per dynamic-region emission. Scope tree mirrors the
   component/region tree → transitive teardown + eager cleanup. (Spec AC-10..14.)

## Changes — `@effect-ui/core`

- **`src/types/index.ts`** — import `Scope`; widen `JSXNode`'s `Stream`/`Effect`
  arms from `JSXRequirements` to `JSXRequirements | Scope.Scope`.
- **`src/jsx-runtime/index.ts`** — `LibraryManagedAttributes` else-branch
  `PropsIn<P>` → `P` (brand-only widening); update the explanatory comment.
- **`src/component/component.ts`**
  - Remove `component()`. Add a `Component` value merged with the `Component<P>`
    interface, exposing `gen`:
    ```ts
    export declare const Component: {
      gen: <P, Eff extends YieldWrap<Effect.Effect<any, any, JSXRequirements | Scope.Scope>>>(
        body: (props: Reactive<P>) => Generator<Eff, JSXNode, never>,
      ) => Component<P>;
    };
    ```
    (mirrors `Effect.gen`'s overload shape; requirements pinned to `JSXRequirements | Scope`.)
  - `Reactive<P>`: `children`-exempt mapped type.
  - `toSubscribable<A>(source, key?)`.
  - Imports: `YieldWrap` from `effect/Utils`; `JSXRequirements` from `~/types`.
- **`src/index.ts`** — drop `component` export, export `Component`; keep
  `toSubscribable`, `isSubscribable`, `NoPropValue`, and types
  `Reactive`/`Component`/`PropsOf`.
- **`src/component/component.specs.md`** — update Overview / Purpose / Public API /
  Types to `Component.gen` (the examples currently show `component()`), and fix the
  Types-section `Reactive<P>` to show `Subscribable<P[K], NoPropValue>` + children
  exemption.

### Implementation — `toSubscribable` (replace the `declare`)

Branch on source kind:

- **`isSubscribable(source)`** → return the reference unchanged (AC-9).
- **static `T`** → `Subscribable.make({ get: Effect.succeed(v), changes: Stream.make(v) })`;
  no fiber (AC-3).
- **`Effect.isEffect(source)`** → memoize with `Effect.cached`; `get` = cached
  effect, `changes` = `Stream.fromEffect(cached)` (runs once, AC-4).
- **`isStream(source)`** → hot/shared pump (AC-5/6/7/8):
  - `SubscriptionRef<Option<A>>` (latest, starts `None`) + a `Deferred<A, NoPropValue>`
    (first-value latch).
  - `forkScoped` a pump: `Stream.runForEach(source, set latest + Deferred.succeed-once)`,
    and on stream end with latest still `None` → `Deferred.fail(new NoPropValue({ key }))`.
  - `get` = read ref → `Some` ⇒ succeed latest (no await, AC-5); `None` ⇒
    `Deferred.await` (parks, AC-6; fails `NoPropValue` if ended empty, AC-7).
  - `changes` = ref `.changes` filtered to present values.
  - Pump uses `forkScoped` ⇒ ambient `Scope` ⇒ dies with the instance scope (AC-10/11).

### Implementation — `Component.gen` (replace the `declare`)

```ts
Component.gen = (body) => (rawProps) =>
  Effect.gen(function* () {
    const props = yield* normalizeProps(rawProps); // per key: children pass-through, else toSubscribable(value, key)
    return yield* body(props); // run the author generator
  });
```

Returns `Effect<JSXNode, any, JSXRequirements | Scope>`; the renderer discharges `Scope`.

## Changes — `@effect-ui/dom` (renderer scopes)

- **`src/client/render.ts`**
  - `renderComponent` (~:734): fork a child scope from the current
    `context.scope` (`Scope.fork(context.scope, ExecutionStrategy.sequential)`);
    run `component(props)`; if the result is an `Effect`/`Stream`, provide the child
    scope as the ambient `Scope.Scope` (discharges `toSubscribable`'s requirement);
    render the result with `RenderContext` re-provided as `{ ...context, scope: child }`.
    The child scope ties prop-pump lifetime to the instance (AC-10/12).
  - `handleStreamChild` (~:783): rotate a **content scope** per emission — close the
    previous (`Scope.close(prev, Exit.void)`), fork a fresh child from
    `context.scope`, render the emission under `{ ...context, scope: content }`.
    Keep the subscription fiber forked in the enclosing `context.scope` (AC-13/14).
  - Add `ExecutionStrategy` import.
- **`src/data.ts`** — `RenderContext.scope` semantics shift to "current enclosing
  reactive scope" (no type change); note it in the doc comment.

Conceptual invariant: scopes form `mount ⊃ region-content ⊃ component ⊃ its-regions ⊃ …`,
so closing any ancestor (region re-emit or unmount) interrupts all descendant pumps.

## Testing (TDD: spec → tests → implement)

- **`src/component/component.test.ts`** (pattern: `src/stream.test.ts`) — AC-3..AC-9:
  static/effect/stream normalization, identity pass-through, hot/shared (source runs
  once), await-first latest/pending, ends-empty ⇒ `NoPropValue` with `key`. Use
  Effect test utilities + `TestClock` for the pending/await cases.
- **`src/component/__type-tests__/component.test-d.ts`** (pattern:
  `src/jsx-runtime/__type-tests__/requirements.test-d.ts`) — AC-1 (props are
  `Subscribable` handles, `children` passes through), AC-2 (caller accepts
  string/Stream/Effect/Subscribable, rejects unrelated), brand-only widening (plain
  function props NOT widened), gen body `.get` + `E = any` compiles.
- **`packages/dom/src/client/*.test.tsx`** (pattern: `dom.test.tsx`) — AC-10/12/13/14
  via an observable finalizer on a streamed prop: assert it runs on dynamic removal,
  not just full unmount, and that re-emits don't accumulate live scopes.

## Verification

- `vp check --fix` (format + lint + typecheck) and `vp test`.
- `vp run typecheck.type-tests` for the `.test-d.ts` files.
- Optional playground recipe: a `Component.gen` with a streamed prop inside a
  conditionally-rendered region; mount, toggle, unmount; confirm pump teardown
  (e.g. via a finalizer log) on both toggle-away and unmount.

## Open / deferred (note in plan, do not build now)

- **Error boundary** for unhandled body errors (currently fiber failure).
- **Suspense** swap (`render.ts` ~:568) should also rotate content scopes — follow-up.
- **`JSXRequirements`** rework — separate effort; kept un-entangled via the
  `| Scope` seam (renderer-provided vs app-service requirements).
