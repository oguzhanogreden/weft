---
title: Component Authoring
order: 2
section: guides
description: Plain functions vs. Component.gen / Component.make, instance scope, fragments, render-prop children, and service requirements.
---

# Component Authoring

Weft components are plain TypeScript functions that return a `Node<E, R>`. This guide covers the two ways to define them and when to choose each.

## Plain functions

The simplest component is just a function:

```typescript
import { h } from "@weftui/core";

function Greeting({ name }: { name: string }) {
  return h.p(`Hello, ${name}!`);
}

// Call it like a function
Greeting({ name: "World" });
```

Use a plain function when:

- Props are all static (strings, numbers, plain functions)
- The component has no internal state
- You don't need the caller's reactive prop types to propagate

## Components with internal state

When a component needs reactive state, use `Effect.gen` to set it up before building the tree. The component function still runs once — the setup happens at mount time:

```typescript
import { h } from "@weftui/core";
import { Effect, SubscriptionRef } from "effect";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    return yield* h.div([
      h.span([count.changes]),
      h.button({ onclick: () => SubscriptionRef.update(count, (n) => n + 1) }, "+"),
    ]);
  });
```

The return type here is `Effect.Effect<Node, never, never>` — itself a valid `Node`, so it composes naturally with other tree-building calls. As soon as such a component is reused or takes props, prefer wrapping the same generator in [`Component.gen`](#componentgen--componentmake-for-reusable-components) (below) so the caller's reactive prop and children channels flow into its node type.

## Component scope and background effects

Every component instance is rendered under its own **instance scope** — a child of the
mount scope created fresh for that instance. Anything bound to the instance scope lives
exactly as long as the component is mounted and is torn down automatically when the
component unmounts (or when the whole tree unmounts via the `MountHandle`). The renderer
provides this scope as the ambient `Scope.Scope` while it evaluates the component body,
so it is already in context when you need it.

This matters the moment a component starts **background work** — a subscription, an
observer of a `ref`, a polling timer, anything you `fork`. The rule:

> Fork background work with **`Effect.forkScoped`**, never a bare `Effect.fork`.

`Effect.forkScoped` attaches the fiber to the instance scope, so it keeps running for
the component's lifetime and is interrupted on unmount. A bare `Effect.fork` instead
attaches the fiber to the component-body fiber — the one that runs your `Effect.gen` to
produce the tree. That fiber completes the instant the gen returns its node, so the
forked work is cancelled almost immediately.

Concretely, an observer that runs an effect when a `ref`'s element mounts:

```typescript
import { h } from "@weftui/core";
import { Effect, Option, pipe, Stream, SubscriptionRef } from "effect";

const AutoFocusInput = () =>
  Effect.gen(function* () {
    const inputRef = yield* SubscriptionRef.make<Option.Option<HTMLInputElement>>(Option.none());

    yield* pipe(
      inputRef.changes,
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runForEach((el) => Effect.sync(() => el.value.focus())),
      Effect.forkScoped, // ✅ tied to the instance scope — survives until unmount
      // Effect.fork,     // ❌ tied to the body fiber — interrupted when the gen returns
    );

    return yield* h.input({ ref: inputRef, type: "text" });
  });
```

You do not manage the scope yourself: you do not create it, close it, or pass it
around. `forkScoped` reads it from context, and unmount closes it for you. If you ever
fork outside a component body (rare), you must supply a `Scope.Scope` yourself — the
type system will tell you, because `forkScoped` carries a `Scope.Scope` requirement.

See `examples/element-ref` for the auto-focus, measure, and canvas recipes built on
this pattern.

## `Component.gen` / `Component.make` for reusable components

When you want the caller's reactive prop types to flow into the returned node's type, use one of the `Component` factories. Both have the same call semantics; pick the body style that fits:

- **`Component.make`** — body is a plain function returning any `Effect` (typically a `Node`). Use for one-liners and pipe compositions.
- **`Component.gen`** — body is a generator. Use when you need `yield*` to set up local state or pull from services.

```typescript
import { Component, h } from "@weftui/core";
import { Stream } from "effect";

interface CardProps {
  title: string | Stream.Stream<string>;
  body?: string | Stream.Stream<string>;
}

const Card = Component.make((props: CardProps) =>
  h.div({ class: "card" }, [
    h.h3({ class: "card-title" }, [props.title]),
    props.body ? h.p({ class: "card-body" }, [props.body]) : null,
  ]),
);
```

Now the caller's stream types are visible in the returned node:

```typescript
declare const titleStream: Stream.Stream<string, never, I18nService>;

// Node<never, I18nService> — I18nService requirement flows out
const card = Card({ title: titleStream });
```

Without a `Component` factory, a plain function's return type is fixed at definition time and won't reflect the caller's reactive prop types.

### Body `E`/`R` inference

You don't declare the body's `E`/`R` channels explicitly — they're inferred from the returned (or yielded) effect:

- The body's `E`/`R` come from whatever effects appear inside.
- The caller's reactive prop channels and reactive children channels are unioned on top at the call site.
- Static prop values (`string`, `number`, plain functions) contribute `never`.

### Children: array or function

Both factories accept an optional second `children` argument, typed as:

```typescript
type Component.Children<Input = never> =
  | readonly Renderable[]
  | ((input: Input) => readonly Renderable[]);
```

The function form is the render-prop / slot pattern — the component invokes the function with whatever input it chooses, and the returned array's `E`/`R` propagate out:

```typescript
const ItemList = Component.make(
  (props: { items: readonly string[] }, renderItem: (item: string) => readonly Renderable[]) =>
    h.ul(props.items.flatMap(renderItem)),
);

ItemList({ items: ["a", "b"] }, (item) => [h.li(item)]);
```

## Props typing

For components that accept both static and reactive values for a prop, type the prop as a union:

```typescript
import { Stream } from "effect";

interface ButtonProps {
  label: string | Stream.Stream<string>; // static or reactive text
  disabled?: boolean | Stream.Stream<boolean>; // static or reactive boolean
  onclick?: () => void | Effect.Effect<void>; // plain or Effect-returning handler
}
```

When a caller passes a plain string, the component's node type has `never` for that prop's channels. When they pass a `Stream.Stream<string, never, SomeService>`, `SomeService` appears in the `R` channel.

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

Children arrays accumulate `E`/`R` from all their members. The parent node's type reflects the union of all children's channels.

## Components that require services

If a component's render function uses a service via `yield*`, that service appears in the component's `CompR` parameter:

```typescript
import { Component, h } from "@weftui/core";

const UserAvatar = Component.gen(function* (props: { userId: string }) {
  const userService = yield* UserService;
  const user = yield* userService.getUser(props.userId);
  return yield* h.img({ src: user.avatarUrl, alt: user.name });
});

// Node<never, UserService> — regardless of what the caller passes
const avatar = UserAvatar({ userId: "123" });
```

Provide the service at the mount boundary:

```typescript
void Effect.runPromise(
  mount(App(), document.getElementById("root")!).pipe(Effect.provide(UserServiceLive)),
);
```

## Returning fragments

When a component needs to return multiple sibling elements without a wrapper, use `h.fragment`:

```typescript
import { h } from "@weftui/core";

const TableCells = ({ row }: { row: Row }) =>
  h.fragment([h.td(row.name), h.td(row.value), h.td(row.status)]);
```

`h.fragment` returns a `Node<E, R>` that accumulates channels from all its children.
