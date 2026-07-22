---
title: Component Authoring
order: 1
section: how-to
description: Plain functions vs. Component.gen / Component.make, instance scope, fragments, render-prop children, and service requirements.
---

# Component Authoring

**Goal:** write a Weft component, a plain function returning a `Node<E, R>`, and pick the right authoring style for its complexity.

## Plain functions

Static props, no internal state: write and call a plain function.

```typescript
import { h } from "@weftui/core";

function Greeting({ name }: { name: string }) {
  return h.p(`Hello, ${name}!`);
}

Greeting({ name: "World" }); // called directly, no JSX, no deferred descriptor
```

Reach for this when:

- Props are all static (strings, numbers, plain functions).
- The component has no internal state.
- You don't need the caller's reactive prop types to propagate into the return type.

## Components with internal state

Set up reactive state with `Effect.gen` before building the tree. The component function still runs once; the setup happens at mount time:

```typescript
import { h } from "@weftui/core";
import { Effect, SubscriptionRef } from "effect";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    return yield* h.div([
      h.span([SubscriptionRef.changes(count)]),
      h.button({ onclick: () => SubscriptionRef.update(count, (n) => n + 1) }, "+"),
    ]);
  });
```

`Effect.Effect<Node, never, never>` is itself a valid `Node`, so it composes with any other tree-building call.

Once a component like this is reused or takes props, wrap the same generator in `Component.gen` (below) so the caller's reactive prop and children channels flow into its node type.

## `Component.gen` / `Component.make`

Both build a component whose returned `Node`'s `E`/`R` include the caller's reactive prop and children channels, not just the body's own:

- **`Component.make`**: body is a plain function returning any `Effect`. Use for one-liners and pipe compositions.
- **`Component.gen`**: body is a generator. Use when you need `yield*` for local state or services.

```typescript
import { Component, h, Source } from "@weftui/core";

interface CardProps {
  title: Source.Source<string>;
  body?: Source.Source<string>;
}

const Card = Component.make((props: CardProps) =>
  h.div({ class: "card" }, [
    h.h3({ class: "card-title" }, [props.title]),
    props.body ? h.p({ class: "card-body" }, [props.body]) : null,
  ]),
);
```

```typescript
declare const titleStream: Stream.Stream<string, never, I18nService>;

// Node<never, I18nService>: I18nService flows out from the prop the caller passed
const card = Card({ title: titleStream });
```

Without a `Component` factory, a plain function's return type is fixed at definition time and can't reflect what the caller actually passes.

- The body's `E`/`R` come from whatever effects it yields or returns.
- Caller prop channels and children channels are unioned on top at the call site.
- Static prop values (`string`, `number`, plain functions) contribute `never`.

### Children: array or function

```typescript
type Component.Children<Input = never> =
  | readonly Renderable[]
  | ((input: Input) => readonly Renderable[]);
```

The function form is the render-prop / slot pattern. The component calls it with whatever `input` it chooses, and the returned array's `E`/`R` propagate out:

```typescript
const ItemList = Component.make(
  (props: { items: readonly string[] }, renderItem: (item: string) => readonly Renderable[]) =>
    h.ul(props.items.flatMap(renderItem)),
);

ItemList({ items: ["a", "b"] }, (item) => [h.li(item)]);
```

## Props typing with `Source`

Type a prop that accepts both static and reactive values as `Source.Source<T>` instead of hand-writing the union:

```typescript
import { Source } from "@weftui/core";

interface ButtonProps {
  label: Source.Source<string>; // static or reactive text
  disabled?: Source.Source<boolean>; // static or reactive boolean
  onclick?: () => void | Effect.Effect<void>; // plain or Effect-returning handler
}
```

`Source.Source<T>` **is** the union `T | Stream<T> | Effect<T> | Subscribable<T>`. A plain string contributes `never` to the node's channels; a `Stream<string, never, SomeService>` contributes `SomeService` to `R`. The extraction is `Source.Success` / `Source.Error` / `Source.Context`.

Splicing a `Source` straight into `h` (`[props.label]`) is enough when the body only places it in the tree. Reach for `Source.toSubscribable` when the body needs to **read or derive** from it:

```typescript
import { Component, h, Source, Subscribable } from "@weftui/core";
import { Stream } from "effect";

const LoudLabel = Component.gen(function* (props: { label: Source.Source<string> }) {
  const label = yield* Source.toSubscribable(props.label); // Subscribable<string>
  return yield* h.strong([Stream.map(Subscribable.changes(label), (text) => text.toUpperCase())]);
});
```

- An existing `Subscribable` prop is threaded through by reference, no new fiber.
- A `Stream` prop is pumped by a fiber scoped to the component's instance scope.
- An `Effect` prop is memoized, so it runs at most once.
- A static value emits once.

## Instance scope and background effects

Every component instance renders under its own **instance scope**, a child of the mount scope created fresh per instance. It closes on unmount (or when its root unmounts via `RootHandle.unmount()`). The renderer supplies it as the ambient `Scope.Scope` while your body runs, so it's already in context.

Fork background work (a subscription, a ref observer, a polling timer) with **`Effect.forkScoped`**, never a bare `Effect.forkChild`:

```typescript
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
      Effect.forkScoped, // ✅ tied to the instance scope: survives until unmount
      // Effect.forkChild, // ❌ tied to the body fiber: interrupted when the gen returns
    );

    return yield* h.input({ ref: inputRef, type: "text" });
  });
```

- `Effect.forkScoped` attaches the fiber to the instance scope, so it keeps running for the component's lifetime and is interrupted on unmount.
- `Effect.forkChild` attaches to the component-body fiber instead, the one that runs your generator to produce the tree. That fiber completes the instant the body returns its node, so a bare fork is cancelled almost immediately.

You never create, close, or pass the scope yourself: `forkScoped` reads it from context, and unmount closes it for you. Forking outside a component body (rare) requires supplying a `Scope.Scope`, and `forkScoped`'s own `Scope.Scope` requirement makes the type system tell you.

See [Use Element Refs](./use-element-refs.md) for the auto-focus, measure, and canvas recipes built on this pattern.

## Composing components

Call component functions directly inside a children array:

```typescript
import { h } from "@weftui/core";

function App() {
  return h.div({ class: "app" }, [
    Header({ title: "My App" }),
    h.main([Sidebar(), h.article([Content({ id: 1 })])]),
    Footer(),
  ]);
}
```

Children arrays accumulate `E`/`R` from all their members; the parent node's type reflects the union.

## Components that require services

A service read via `yield*` inside the body appears in the component's `R` channel, regardless of what the caller passes:

```typescript
import { Component, h } from "@weftui/core";

const UserAvatar = Component.gen(function* (props: { userId: string }) {
  const userService = yield* UserService;
  const user = yield* userService.getUser(props.userId);
  return yield* h.img({ src: user.avatarUrl, alt: user.name });
});

// Node<never, UserService>
const avatar = UserAvatar({ userId: "123" });
```

Give the service to the app layer, not to the mount call:

```typescript
import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";

const app = WeftApp.make(UserServiceLive);
void Effect.runPromise(WeftApp.mount(app, App(), document.getElementById("root")!));
```

See [Provide Services](./provide-services.md) for scoped layers, `memoMap` sharing, and why wrapping `Effect.provide` around the mount call doesn't work.

## Returning fragments

Return multiple sibling elements without a wrapper using `h.fragment`:

```typescript
import { h } from "@weftui/core";

const TableCells = ({ row }: { row: Row }) =>
  h.fragment([h.td(row.name), h.td(row.value), h.td(row.status)]);
```

`h.fragment` returns a `Node<E, R>` that accumulates channels from all its children, same as any other `h.*` call.

## See also

- [The Combinator API](../explanation/combinator-api.md): `h`, `h.fragment`, and how `E`/`R` accumulate
- [Reactive Primitives](../explanation/reactive-primitives.md): the `Source` vocabulary props accept
- [Use Element Refs](./use-element-refs.md): `ref` props and scoped mount observers
- [Provide Services](./provide-services.md): app layers, scoped layers, and `memoMap`
- [Add Routing](./add-routing.md): route components are `Component` slots
- [`@weftui/core` reference](../reference/core.md): `Component`, `Source`, and the full surface
