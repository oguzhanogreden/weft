# Combinator API

## Overview

A typed tree-building API that preserves Effect's `E` and `R` channels through the template structure. `Node<E, R>` IS `Effect.Effect<DOMNode, E, R>`, so requirements and errors accumulate through the full tree and are visible to the type system end-to-end.

---

## Design decisions

### Node IS an Effect

`Node<E, R>` is a type alias for `Effect.Effect<DOMNode, E, R>`. This means:

- `yield* h.div(...)` works natively in `Effect.gen` and propagates `R`
- `() => h.div(...)` preserves `R` on the return type
- All Effect combinators (`Effect.provide`, `Effect.map`, `pipe`, etc.) work on nodes
- No parallel type system — nodes are first-class Effects

### Plain config objects for everything

Both HTML elements and custom components take a plain props object. No attr-function pattern (`className("foo")`), no separate attr namespace. Consistent call signature across the entire API:

```ts
h.div({ className: "container" }, [
  h.span({ className: "title" }, "Hello"),
  TextField({ name: "email", value: userStream }),
]);
```

`E` and `R` are extracted from reactive prop values (Stream, Effect, Subscribable) via mapped types — no special wrapper needed. When a prop value is a plain string/number/function, it contributes `never` to both channels.

### `h` namespace for HTML elements

All intrinsic elements live under `h` to avoid polluting the local scope and to make the element/component distinction visually clear at a glance:

```ts
h.div, h.span, h.input, h.button, h.form, ...
```

Custom components are imported and called directly without a namespace prefix.

### Children as last argument

The second argument (or first, if props are omitted) is either:

- `Node[]` — children array with accumulated `E`/`R`
- `string | number` — single static child
- Omitted — no children

### `node()` as escape hatch

`node(effect | stream)` lifts any `Effect` or `Stream` directly into the tree. This is the primary mechanism for introducing `E` and `R` into a subtree when not coming from a prop value.

### `defineComponent` for custom components

Custom components are defined with a plain TypeScript interface for props and a render function. The factory returns a generic function so the caller's specific reactive prop values contribute their `E`/`R` to the returned node:

```ts
interface TextFieldProps {
  name: string
  value?: string | Stream.Stream<string, any, any>
  onChange?: (value: string) => void
}

const TextField = defineComponent<TextFieldProps, never, never>(
  (props) => h.div({ className: "field" }, [...])
)

TextField({ name: "email", value: userStream })
// Node<never, UserService>
```

The component's own internal `E`/`R` (from its render function) unions with the caller's props `E`/`R`.

No `Prop.fn()`, `Prop.source()`, or descriptor system — plain TypeScript interfaces handle both value and function props.

### Scoped children (`$`) — deferred

A Jetpack Compose-inspired scoped callback (`$ => [$.span(...)]`) was explored and validated but deferred. It enables:

- Per-element child vocabulary (only valid children for a given element)
- Custom component scopes (Radix/Base-UI-style slot patterns)
- Render prop / callback children with typed state

Deferring because it cascades into component factory design decisions that aren't ready yet. The plain array form is compatible — the scope can be layered on later as an additional overload.

### `toView` / headless pattern — deferred

Foldkit-inspired pattern where a component exposes its managed attributes (aria, role, event bindings) to the caller, who decides the actual element:

```ts
Button({
  onClick: handleSave,
  toView: (attrs) => h.button({ ...attrs.button, className: "btn" }, ["Save"]),
});
```

The component owns behaviour and accessibility; the caller owns structure and style. `toView` returning a `Node<E, R>` means R from the caller's render function flows into the component's type naturally. Deferred alongside scoped children.

---

## Acceptance criteria

### Core type accumulation

- `Node<E, R>` must be assignable to `Effect.Effect<DOMNode, E, R>`
- Reactive prop values (Stream, Effect, Subscribable) contribute their `R` to the node's `R`
- Reactive prop values contribute their `E` to the node's `E`
- `R` from `node(stream)` children accumulates into the parent node's `R`
- `E` from `node(effect)` children accumulates into the parent node's `E`
- `R` and `E` accumulate across sibling children (union)
- `R` and `E` propagate through arbitrary nesting depth
- Reactive props and reactive children both contribute — unioned

### Custom components

- `defineComponent` render function's `E`/`R` is fixed at definition time
- Caller's reactive prop values contribute additional `E`/`R` at call site
- Total `E`/`R` is the union of component's own and caller's props
- Static prop values (`string`, `number`, `() => void`) contribute `never`

### Compatibility

- `() => h.div(...)` — plain function wrapper preserves `R` on the return type
- `Effect.gen(function* () { return yield* h.div(...) })` — `yield*` works, `R` propagates into the generator's context channel
- `Effect.provide(h.div(...), layer)` — standard Effect combinators work on nodes

### Static content

- `h.div({ className: "foo" }, "Hello")` — `Node<never, never>`
- `h.div({ className: "foo" }, [h.span({}, "Hello")])` — `Node<never, never>`
- `h.div({ id: "app" })` — `Node<never, never>`
- `h.div({})` — `Node<never, never>`
- `h.div([node(stream)])` — children only, no props

---

## API surface (validated)

```ts
// Core types
type Node<E = never, R = never> = Effect.Effect<DOMNode, E, R>

// R/E extraction (internal)
type PropsE<P> = { [K in keyof P]: P[K] extends Stream<any, infer E, any> ? E : ... }[keyof P]
type PropsR<P> = { [K in keyof P]: P[K] extends Stream<any, any, infer R> ? R : ... }[keyof P]
type NodesE<T extends readonly Node[]> = { [K in keyof T]: ... }[number]
type NodesR<T extends readonly Node[]> = { [K in keyof T]: ... }[number]

// Escape hatch
declare function node<E, R>(source: Effect<unknown, E, R> | Stream<unknown, E, R>): Node<E, R>

// Element namespace (one per HTML element, generated from src/types/html/)
declare namespace h {
  function div<P extends DivProps, C extends readonly Node[]>(props: P, children: C): Node<PropsE<P> | NodesE<C>, PropsR<P> | NodesR<C>>
  function div<P extends DivProps>(props: P, child: string | number): Node<PropsE<P>, PropsR<P>>
  function div<P extends DivProps>(props: P): Node<PropsE<P>, PropsR<P>>
  function div<C extends readonly Node[]>(children: C): Node<NodesE<C>, NodesR<C>>
  // span, p, ul, li, button, form, input, ... same pattern
}

// Component factory
declare function defineComponent<BaseProps, CompE, CompR>(
  render: (props: BaseProps) => Node<CompE, CompR>
): <P extends BaseProps>(props: P) => Node<PropsE<P> | CompE, PropsR<P> | CompR>
```

---

## What's next

- **HTML prop types** — `DivProps`, `SpanProps`, etc. generated from the existing `src/types/html/` types; each element's props constrain which keys are valid
- **Scoped children (`$`)** — layer on as additional overloads once component factory design is settled
- **`toView` / headless pattern** — `toView: (attrs: ButtonAttrs) => Node<E, R>` prop for components that expose their managed attributes to the caller
- **Custom component scopes** — typed child vocabulary per component; enables `Dialog.Root` / `Dialog.Content` slot patterns
- **Runtime implementation** — replace `declare` mocks with real rendering logic; nodes are Effects run within a provided scope/layer
