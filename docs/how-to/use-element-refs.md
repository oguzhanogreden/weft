---
title: Use Element Refs
order: 11
section: how-to
description: Capture a DOM element with the ref prop into a SubscriptionRef<Option<HTMLElement>>, then react to its mount with a scoped observer or read it imperatively.
---

# Use Element Refs

**Goal:** get a handle to a real DOM element, to focus it, measure it, or call an imperative browser API on it.

Declare a `SubscriptionRef<Option<HTMLElement>>` and attach it with the `ref` prop. Then either **react** to the element appearing (a scoped observer on `SubscriptionRef.changes(ref)`) or **read** it later inside a handler.

```typescript
import { h } from "@weftui/core";
import { Effect, Option, pipe, Stream, SubscriptionRef } from "effect";

const AutoFocusInput = () =>
  Effect.gen(function* () {
    const inputRef = yield* SubscriptionRef.make<Option.Option<HTMLInputElement>>(Option.none());

    // Observe the element becoming available, once, and focus it.
    yield* pipe(
      SubscriptionRef.changes(inputRef),
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runForEach((el) => Effect.sync(() => el.value.focus())),
      Effect.forkScoped, // ← ties the observer to the component's instance scope
    );

    return yield* h.input({ ref: inputRef, type: "text", placeholder: "I'm focused!" });
  });
```

## The `ref` prop

`ref` accepts a `SubscriptionRef<Option<T>>`, and nothing else: a plain `Ref` doesn't match the prop's type, and the renderer only recognizes a `SubscriptionRef`. The renderer sets it to `Option.some(element)` **once**, when the element is created:

```typescript
ref?:
	| SubscriptionRef.SubscriptionRef<Option.Option<T>>
	| ReadonlyArray<SubscriptionRef.SubscriptionRef<Option.Option<any>>>;
```

The ref is an `Option` because of this timing: `None` until mount, `Some(el)` after. It stays `Some` after unmount too; nothing clears it.

## Fork the observer with `Effect.forkScoped`

`Stream.filter(Option.isSome)` waits for the element, `Stream.take(1)` takes just its first appearance, and `Stream.runForEach` runs the imperative work once. Fork that pipeline with `Effect.forkScoped`, never `Effect.forkChild`:

```typescript
declare const observer: Effect.Effect<void>; // the filter/take/runForEach pipeline

yield * Effect.forkScoped(observer); // ties the fiber to the component's instance scope
yield * Effect.forkChild(observer); // wrong: dies the instant the component body returns
```

`forkScoped` ties the fiber to the component's **instance scope**, the ambient `Scope` the renderer provides per component. It lives as long as the component is mounted. `forkChild` binds to the transient component-body fiber instead, which is interrupted the instant the generator returns, so the observer would never fire.

## Read a ref imperatively

When you only need the element later (e.g. in a click handler), skip the observer and read the ref on demand with `SubscriptionRef.get`:

```typescript
const scroll = () =>
  Effect.gen(function* () {
    const el = yield* SubscriptionRef.get(targetRef);
    if (Option.isSome(el)) el.value.scrollIntoView({ behavior: "smooth" });
  });
```

## Share a ref across behaviors

`ref` also accepts a `ReadonlyArray` of refs: every entry receives the element (fan-out). This is the single-ref contract that fan-out builds on, so a shared behavior's ref and your own can coexist on the same element:

```typescript
h.div({ ref: [measureRef, focusRef] });
```

`Props.merge` produces this array automatically when both prop bags being merged carry a `ref`, concatenating rather than overwriting. See [Compose Behavior and Markup](./compose-behavior-and-markup.md) for the full merge rules.

## Complete example

An auto-focusing input and a measured box, mounted with no other services. The whole file set:

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weft element ref demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```typescript
// src/app.ts
/**
 * Element ref demo: an auto-focusing input and a box that reports its own
 * measured size after mount. Side-effect-free (no mount call), so `main.ts`
 * and any test can import `App` directly.
 */
import { h } from "@weftui/core";
import { Effect, Option, pipe, Stream, SubscriptionRef } from "effect";

const AutoFocusInput = () =>
  Effect.gen(function* () {
    const inputRef = yield* SubscriptionRef.make<Option.Option<HTMLInputElement>>(Option.none());

    yield* pipe(
      SubscriptionRef.changes(inputRef),
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runForEach((el) => Effect.sync(() => el.value.focus())),
      Effect.forkScoped,
    );

    return yield* h.input({ ref: inputRef, type: "text", placeholder: "I'm focused!" });
  });

const MeasuredBox = () =>
  Effect.gen(function* () {
    const boxRef = yield* SubscriptionRef.make<Option.Option<HTMLDivElement>>(Option.none());
    const size = yield* SubscriptionRef.make("measuring...");

    yield* pipe(
      SubscriptionRef.changes(boxRef),
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runForEach((el) =>
        Effect.gen(function* () {
          const rect = el.value.getBoundingClientRect();
          yield* SubscriptionRef.set(size, `${rect.width}x${rect.height}`);
        }),
      ),
      Effect.forkScoped,
    );

    return yield* h.div([
      h.div({ ref: boxRef, style: { width: "200px", height: "80px", border: "1px solid" } }),
      h.p(["size: ", SubscriptionRef.changes(size)]),
    ]);
  });

export const App = () => h.div([AutoFocusInput(), MeasuredBox()]);
```

```typescript
// src/main.ts
/**
 * Browser entry: mounts the demo into `#root`. No app layer is needed here,
 * so `WeftApp.make()` takes no arguments.
 */
import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

const app = WeftApp.make();
void Effect.runPromise(WeftApp.mount(app, App(), root));
```

## Notes

- A component with local state, like the two above, is written as a plain `Effect.gen` function; see [Component Authoring](./author-components.md#components-with-internal-state).
- Coming from React: `SubscriptionRef.make<Option<T>>(Option.none())` ↔ `useRef<T>(null)`; the `Stream.filter(Option.isSome)` observer ↔ a `useEffect` mount guard.

## See also

- [Reactive Primitives](../explanation/reactive-primitives.md): `SubscriptionRef` and `SubscriptionRef.changes`
- [Author Components](./author-components.md): instance scope and `Effect.forkScoped`
- [Compose Behavior and Markup](./compose-behavior-and-markup.md): merging a shared behavior's `ref` with your own
- [examples/element-ref](../../examples/element-ref): auto-focus, element measurement, and imperative scroll via refs
