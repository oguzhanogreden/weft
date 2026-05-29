# Component Authoring

effect-ui components are plain TypeScript functions that return a `Node<E, R>`. This guide covers the two ways to define them and when to choose each.

## Plain functions

The simplest component is just a function:

```typescript
import { h } from "@effect-ui/core";

function Greeting({ name }: { name: string }) {
  return h.p({}, `Hello, ${name}!`);
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
import { h } from "@effect-ui/core";
import { Effect, SubscriptionRef } from "effect";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    return yield* h.div({}, [
      h.span({}, [count.changes]),
      h.button({ onclick: () => SubscriptionRef.update(count, (n) => n + 1) }, "+"),
    ]);
  });
```

The return type here is `Effect.Effect<Node, never, never>` — itself a valid `Node`, so it composes naturally with other tree-building calls.

## `defineComponent` for reusable components

When you want the caller's reactive prop types to flow into the returned node's type, use `defineComponent`:

```typescript
import { defineComponent, h } from "@effect-ui/core";
import { Stream } from "effect";

interface CardProps {
  title: string | Stream.Stream<string>;
  body?: string | Stream.Stream<string>;
}

const Card = defineComponent<CardProps, never, never>((props) =>
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

Without `defineComponent`, the return type of a plain function is fixed at definition time and won't reflect the caller's reactive prop types.

### The generic params

```typescript
defineComponent<BaseProps, CompE, CompR>(render);
```

- **`BaseProps`** — the props interface, with reactive fields typed as their widest form (`string | Stream.Stream<string>`)
- **`CompE`** — the error type the component's own render function can raise (often `never`)
- **`CompR`** — the services the component's own render function requires (often `never`)

The caller's prop channels are unioned on top of `CompE`/`CompR` at the call site.

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
import { h } from "@effect-ui/core";

function App() {
  return h.div({ class: "app" }, [
    Header({ title: "My App" }),
    h.main({}, [Sidebar(), h.article({}, [Content({ id: 1 })])]),
    Footer(),
  ]);
}
```

Children arrays accumulate `E`/`R` from all their members. The parent node's type reflects the union of all children's channels.

## Components that require services

If a component's render function uses a service via `yield*`, that service appears in the component's `CompR` parameter:

```typescript
import { defineComponent, h } from "@effect-ui/core";
import { Effect } from "effect";

const UserAvatar = defineComponent<{ userId: string }, never, UserService>((props) =>
  Effect.gen(function* () {
    const userService = yield* UserService;
    const user = yield* userService.getUser(props.userId);
    return yield* h.img({ src: user.avatarUrl, alt: user.name });
  }),
);

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
import { h } from "@effect-ui/core";

const TableCells = ({ row }: { row: Row }) =>
  h.fragment([h.td({}, row.name), h.td({}, row.value), h.td({}, row.status)]);
```

`h.fragment` returns a `Node<E, R>` that accumulates channels from all its children.
