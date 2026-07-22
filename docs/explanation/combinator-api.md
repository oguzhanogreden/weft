---
title: The Combinator API
order: 2
section: explanation
description: How h, h.fragment, and Component.gen / Component.make work; why Node is an Effect; how E and R accumulate through a tree.
---

# The Combinator API

Weft builds UI trees by calling builder functions, not by writing markup. There is no JSX runtime and no `h(Component)` overload: a component is a plain function you call, and its result goes straight into the tree.

```typescript
// No JSX, no deferred element. Header/Main/Footer already ran; these are Nodes.
const tree = h.div({ class: "app" }, [Header(), Main(), Footer()]);
```

Because a component's return type stays a concrete `Effect.Effect<ElementDescriptor, E, R>`, its error channel (`E`) and requirement channel (`R`) propagate through the whole tree. Both are visible to the type checker and satisfiable exactly once, at the mount boundary.

JSX collapses every component's return type to an opaque `JSX.Element`, erasing both channels. The combinator API exists specifically to keep them intact.

## Nodes are Effects

`Node<E, R>` is defined as:

```typescript
type Node<E = never, R = never> = Effect.Effect<ElementDescriptor, E, R>;
```

Nodes are first-class Effects. Everything in the Effect ecosystem works on them directly:

```typescript
import { h } from "@weftui/core";
import { Effect } from "effect";

// yield* in Effect.gen: R propagates into the generator's context
const node = yield * h.div({ class: "container" }, "Hello");

// pipe: chain Effect operators directly
const provided = pipe(h.div(userStream), Effect.provide(UserServiceLive));

// Effect.flatMap: sequence node creation with async logic
const card = pipe(
  fetchCard(id),
  Effect.flatMap((data) => h.div({ class: "card" }, data.title)),
);
```

## The `h` namespace

`h` is a proxy object where every property is an element builder. Access any HTML or SVG tag name as `h.tagName`:

```typescript
import { h } from "@weftui/core";

h.div({ class: "container" }, [h.span("Hello"), h.p("World")]);
h.input({ type: "text", placeholder: "Search..." });
h.button({ type: "button", onclick: () => handleClick() }, "Submit");
```

Each builder accepts these call signatures:

```typescript
// props + children array
h.div(props, children: Node[])

// props + single string or number child
h.div(props, child: string | number)

// props only
h.div(props)

// children only (no props)
h.div(children: Node[])

// single string or number child
h.div("five")
h.div(5)

// no props, no children
h.div()
```

### How `E` and `R` accumulate

Reactive prop values (any `Stream`, `Effect`, or `Subscribable`) contribute their channels to the node:

```typescript
declare const colorStream: Stream.Stream<string, never, ThemeService>;

// Node<never, ThemeService>: R comes from the stream prop
const box = h.div({ style: { color: colorStream } }, "Hello");
```

Children contribute their channels too, and siblings union their channels:

```typescript
declare const nodeA: Node<never, ServiceA>;
declare const nodeB: Node<never, ServiceB>;

// Node<never, ServiceA | ServiceB>
const parent = h.div([nodeA, nodeB]);
```

Static values (strings, numbers, plain functions) contribute `never` to both channels.

## `h.fragment`

`h.fragment` groups children without emitting a wrapper element. Use it when a component needs to return multiple sibling nodes:

```typescript
import { h } from "@weftui/core";

// Renders as three adjacent <td> elements with no wrapping element
const TableRow = ({ user }: { user: User }) =>
  h.fragment([h.td(user.name), h.td(user.role), h.td(user.status)]);
```

## Custom components with `Component.gen` / `Component.make`

Plain functions work fine for simple components. The `Component` factories add type-level wiring: the caller's actual reactive prop types contribute their `E`/`R` to the node returned at that call site, not just the types you wrote in the signature. Pick `Component.make` for a plain-function body, `Component.gen` for a generator body (when you need `yield*` for local state or a service).

```typescript
import { Component, h } from "@weftui/core";
import { Stream } from "effect";

interface ButtonProps {
  label: string | Stream.Stream<string>;
  onclick?: () => void;
}

const Button = Component.make((props: ButtonProps) =>
  h.button({ onclick: props.onclick }, [props.label]),
);

// When called with a stream prop, the stream's R flows into the node type:
declare const labelStream: Stream.Stream<string, never, I18nService>;

// Node<never, I18nService>
const btn = Button({ label: labelStream });
```

Components also accept an optional `children` argument: either `readonly Renderable[]`, or a `(input) => readonly Renderable[]` function for the render-prop pattern. Either way, the children's `E`/`R` accumulate onto the resulting node, including the array a function-children call returns.

A plain function without `Component` has its return type fixed at definition time. It reflects only the prop types you wrote, never a specific caller's reactive prop types.

See [Author Components](../how-to/author-components.md) for a full walkthrough.

## Boundaries accumulate channels too

`Boundary.suspend`, `Boundary.catch`, and the rest of the `Boundary` namespace are Nodes, not a separate concept. A boundary wraps children and its own type is `Node<ChildrenE, ChildrenR>`, so the same accumulation rules apply:

```typescript
import { Boundary, h } from "@weftui/core";

// Node<ChildrenE, ChildrenR>: transparent to E/R, like a plain h.* parent
Boundary.suspend({ fallback: h.div({ class: "spinner" }, "Loading...") }, [
  AsyncCard({ id: 1 }),
  AsyncCard({ id: 2 }),
]);
```

A boundary changes _when_ and _whether_ its children's output reaches the DOM, not what its type carries. `Boundary.catchTag` is the one exception: it removes the matched tag from `E`, since that's the failure it discharges.

See [Boundaries and Suspense](./boundaries-and-suspense.md) for what each boundary variant does, and the [core reference](../reference/core.md#boundary-namespace) for the full `Boundary.*` surface.

## See also

- [The Rendering Model](./rendering-model.md): why a `Node` is an `Effect` and how the tree renders
- [Reactive Primitives](./reactive-primitives.md): the `Source` vocabulary that reactive props and children accept
- [Boundaries and Suspense](./boundaries-and-suspense.md): the boundary combinators as tree nodes
- [Author Components](../how-to/author-components.md): `Component.gen` / `Component.make` in practice
- [`@weftui/core` reference](../reference/core.md)
