# Plan — Component Definition & Prop Normalization (`Component.gen`)

> Companion spec: `packages/core/src/component/component.specs.md` — this is dated and needs changes as per this plan.

## Context

`@effect-ui/core` needs a component boundary where a prop shape `P` wears two faces:
the **caller/JSX side** accepts `Source<T>` (a static `T`, `Stream<T>`,
`Effect<T>`, or `Subscribable<T>`), and the **author side** receives `Reactive<P>`
— every slot a `Subscribable<T, NoPropValue>` handle exposing `.changes` (live
stream) and `.get` (await-first current value).

After an extended design discussion we settled the shape below. The headline
reason for the factory (vs. authors hand-normalizing) is that it **erases the
static↔reactive distinction at the author boundary**: switching a caller from a
literal to a stream never forces edits inside the component (the typically-seen-in-Vue
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
   per-slot `Source` widening; plain function components are passed props
   as authored.
4. **`toSubscribable(source, key?)`** — the optional `key` is carried on
   `NoPropValue`; `Component.gen` supplies each prop's key while normalizing.
5. **`children` is exempt on both faces** — neither `Reactive<P>` (author) nor
   `PropsIn<P>` (caller) wraps `children`; its declared type passes through
   untouched. Reactive children already flow through `JSXNode`'s own `Stream`/`Effect`
   arms, so the default `children: JSXNode` needs no `Subscribable` wrapping to stay
   reactive. Narrowing `children` away from `JSXNode` — a render-prop function
   (`children: (state) => JSXNode`), a scalar — forfeits those arms but still passes
   raw; that is what makes render-prop / headless patterns work (the author owns the
   call protocol and can hand children a `Subscribable<T>` of internal state).
6. **`JSXNode` reactive arms advertise `Scope`** — widened to
   `... , JSXRequirements | Scope.Scope`, so a gen body's returned effect (which
   requires the renderer-provided `Scope`) is a valid `JSXNode`.
7. **Body error channel is unconstrained (`any`) — for now** — relies on `any ⊑ never`
   so the produced `Effect<JSXNode, any, …>` still fits `JSXNode`'s `E = never` arm.
   This erases the body's **entire** error channel, not just `NoPropValue`: any
   unhandled author error (a failing service call, an unhandled `NoPropValue` from
   `.get`) surfaces as a fiber failure at the enclosing region — the seam a future
   error boundary plugs into. Handling `.get` is optional, not forced. A typed body
   channel is a deliberate non-goal here; it lands with the JSX error-signature
   rework (see Open / deferred).
8. **Per-component child scopes in the renderer** — core requires only the
   standard `Scope`; the renderer (`@effect-ui/dom`) supplies a child scope per
   component instance and per dynamic-region emission. Scope tree mirrors the
   component/region tree → transitive teardown + eager cleanup. (Spec AC-10..14.)

## Changes — `@effect-ui/core`

- **`src/types/index.ts`** — import `Scope`; widen `JSXNode`'s `Stream`/`Effect`
  arms from `JSXRequirements` to `JSXRequirements | Scope.Scope`.
- **`src/jsx-runtime/index.ts`** — `LibraryManagedAttributes` else-branch
  `PropsIn<P>` → `P` (brand-only widening); update the explanatory comment. Move the
  `PropsIn` definition out of this file into `component.ts` (below) and import it; the
  branded branch keeps using `PropsIn<Raw>`.
- **`src/component/component.ts`**
  - Retype the `Component<P>` interface to match runtime (honest about both faces):
    ```ts
    export interface Component<P> {
      (props: PropsIn<P>): Effect.Effect<JSXNode, any, JSXRequirements | Scope.Scope>;
      readonly [RawProps]?: P;
    }
    ```
    Input is the raw caller view `PropsIn<P>` (the renderer passes raw props; `gen`
    normalizes internally); output is the gen's effect. `LibraryManagedAttributes`
    infers `Raw` from the `[RawProps]` brand, **not** the call signature, so JSX is
    unaffected — and direct composition (`MyComp(props)`) now takes ordinary caller
    props and yields a `JSXNode`.
  - Co-locate both prop faces here, each exempting `children` identically:
    ```ts
    export type PropsIn<P> = {
      [K in keyof P]: K extends "children" ? P[K] : Source<P[K]>;
    };
    export type Reactive<P> = {
      readonly [K in keyof P]: K extends "children"
        ? P[K]
        : Subscribable.Subscribable<P[K], NoPropValue>;
    };
    ```
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
  - `toSubscribable<A>(source, key?)`.
  - Imports: `YieldWrap` from `effect/Utils`; `JSXRequirements` + `Source` from `~/types`.
- **`src/index.ts`** — drop `component` export, export `Component`; keep
  `toSubscribable`, `isSubscribable`, `NoPropValue`, and types
  `Reactive`/`Component`/`PropsOf`/`PropsIn`.
- **`src/component/component.specs.md`** (flagged dated — the matching edits it needs):
  - Overview / Purpose / Public API: `component()` → `Component.gen`; examples become
    `Component.gen(function* (props) { … })`.
  - Public API: retype `Component<P>` to
    `(props: PropsIn<P>) => Effect<JSXNode, any, JSXRequirements | Scope.Scope>`;
    document the `[RawProps]` brand as the inference carrier; add `PropsIn<P>` to the
    Types section as the caller face.
  - Types: `Reactive<P>` shows `Subscribable<P[K], NoPropValue>` with the `children`
    carve-out; state the children rule on **both** faces and that reactive children
    flow via `JSXNode`'s `Stream`/`Effect` arms (with a render-prop / headless example).
  - Design Decisions: note the body error channel is `any` — the **entire** channel
    is erased, not just `NoPropValue` — and that a typed channel is deferred.
  - Add a **render-timing** note: `.get` during setup withholds the first render until
    the prop emits (markers placed, content streams in; Suspense fallback until settle);
    binding `.changes` renders immediately. `.changes` completes for static props but
    is infinite for stream props.
  - AC-10: reword "survives the instance's own re-renders" → "survives internal region
    re-emission" (nothing re-renders in this stream-update model).

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

> `Source`'s `Stream`/`Effect` arms are pinned to `never` error/requirements
> (`Stream.Stream<T>` / `Effect.Effect<T>`), so the pump needn't handle source failure
> or discharge source requirements. A failing source would otherwise hang a pending
> `.get`; widening `E`/`R` on prop sources is part of the deferred JSX-signature rework.

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

**Governing rule:** the ambient `Scope.Scope` _service_ and `RenderContext.scope` are
always provided **together**, pointing at the same scope (the current enclosing reactive
scope). This is new: today the renderer only threads `context.scope` as a _field_ and
forks via `Effect.forkIn` — it never provides the ambient `Scope.Scope` service that
`forkScoped` reads, so that service has to start being provided at every scope boundary.

- **`src/client/render.ts`**
  - `renderComponent` (~:734): run `component(props)`; **only if** the result is an
    `Effect`/`Stream`, fork a child scope from `context.scope`
    (`Scope.fork(context.scope, ExecutionStrategy.sequential)`) and render it under that
    child as **both** the ambient `Scope.Scope` (discharges `toSubscribable`'s pump) and
    `RenderContext.scope` (so nested regions / `forkIn` use it). Ties prop-pump lifetime
    to the instance (AC-10/12); a plain JSXNode result needs no scope.
  - `handleStreamChild` (~:783): rotate a **content scope** per emission — close the
    previous (`Scope.close(prev, Exit.void)`), fork a fresh child from `context.scope`,
    render the emission under that content scope (both service + field, per the rule).
    Keep the subscription fiber forked in the enclosing `context.scope` (AC-13/14).
  - `mount` / `hydrate` (~:925 / ~:1030): seed the root ambient `Scope.Scope` (the mount
    scope) alongside `RenderContext`, so a root-level leaf effect/stream or `forkScoped`
    has an ambient scope.
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
  `Subscribable` handles; `children` passes through on the author face, incl. a
  render-prop `children: (s) => JSXNode`), AC-2 (caller accepts
  string/Stream/Effect/Subscribable, rejects unrelated; `children` is **not** widened on
  the caller face either), brand-only widening (plain function props NOT widened), gen
  body `.get` + `E = any` compiles, and a direct `MyComp(callerProps)` call yields a
  `JSXNode`.
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
- **Typed body-error channel** — the `E = any` erasure (decision 7) is temporary; a
  typed channel lands with the error boundary + the JSX error-signature rework.
- **Suspense** swap (`render.ts` ~:568) should also rotate content scopes — follow-up.
- **`JSXNode` `Stream`/`Effect` variants × component signatures** — these lose type
  information today, and `JSXRequirements` is a brittle global augmentation. Reworking
  the JSX value/error/requirements signature is a separate effort; kept un-entangled here
  via the `| Scope` seam (renderer-provided vs app-service requirements) and the
  `never`-pinned `Source` arms (no `R`/`E` widening on prop sources yet).
