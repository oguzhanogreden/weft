# @effect-ui/core API Reference

## Element builders

### `h`

Proxy-based namespace for building HTML and SVG elements. Every property is an element builder for that tag name:

```typescript
import { h } from "@effect-ui/core";

h.div(props, children)
h.span(props, child: string | number)
h.input(props)
h.ul(children)
// ...any HTML or SVG tag
```

Each builder has four overloads:

| Signature                               | Description                  |
| --------------------------------------- | ---------------------------- |
| `h.tag(props, children: Node[])`        | Props + array of child nodes |
| `h.tag(props, child: string \| number)` | Props + single static child  |
| `h.tag(props)`                          | Props only, no children      |
| `h.tag(children: Node[])`               | Children only, no props      |

**Return type**: `Node<PropsE<P> | ChildrenE<C>, PropsR<P> | ChildrenR<C>>`

Reactive prop values (Stream, Effect, Subscribable) contribute their `E`/`R` to the node. Static values contribute `never`. Children's channels are unioned with props' channels.

### `h.fragment`

Groups children into a fragment that renders without a wrapper element:

```typescript
import { h } from "@effect-ui/core";

h.fragment(children: Node[]): Node<ChildrenE, ChildrenR>
```

Use when a component needs to return multiple sibling elements.

### `defineComponent`

Factory for reusable components with caller-propagating reactive prop types:

```typescript
import { defineComponent } from "@effect-ui/core";

defineComponent<BaseProps, CompE, CompR>(
  render: (props: BaseProps) => Node<CompE, CompR>
): <P extends BaseProps>(props: P) => Node<PropsE<P> | CompE, PropsR<P> | CompR>
```

**Generic params**:

- `BaseProps` — the component's props interface
- `CompE` — the error type raised by the component's own render function
- `CompR` — the services required by the component's own render function

The returned function is generic over `P extends BaseProps`, so the caller's specific reactive prop types contribute their channels at the call site.

**Example**:

```typescript
interface TextFieldProps {
  value?: string | Stream.Stream<string>;
  onChange?: (v: string) => void;
}

const TextField = defineComponent<TextFieldProps, never, never>((props) =>
  h.input({
    value: props.value,
    oninput: (e) => props.onChange?.((e.target as HTMLInputElement).value),
  }),
);
```

### `Suspense`

Boundary component that shows a fallback while async children are pending:

```typescript
import { Suspense } from "@effect-ui/core";

Suspense(
  props: { fallback?: Child },
  children: Node[]
): Node<ChildrenE, ChildrenR>
```

- Shows `fallback` while any registered child has not yet emitted its first value
- Performs a single atomic DOM swap once all children have settled
- Works on both the server (streaming patch model) and the client
- `hydrate()` sees through `Suspense` boundaries and adopts resolved DOM in place

---

## Types

### `Node<E, R>`

```typescript
type Node<E = never, R = never> = Effect.Effect<DOMNode, E, R>;
```

The core tree type. Every element builder and component returns a `Node`. Because `Node` is an alias for `Effect.Effect`, all Effect operators work on nodes directly.

### `Source` namespace

The `Source` namespace contains the reactive prop vocabulary type and its normalization utility:

```typescript
import { Source } from "@effect-ui/core";

// The type union
type Source.Source<A, E, R> = A | Effect.Effect<A, E, R> | Stream.Stream<A, E, R> | Subscribable<A, E, R>
```

Any prop or child that supports reactivity accepts a `Source.Source`. Static values, Effects, Streams, and Subscribables are all valid.

#### `Source.toSubscribable(source, key?)`

Normalizes any `Source.Source` into a hot `Subscribable<A, E | NoPropValue, R>` scoped to the enclosing `Scope`:

```typescript
Source.toSubscribable<A, E, R>(
  source: Source.Source<A, E, R>,
  key?: string
): Effect.Effect<Subscribable<A, E | NoPropValue, R>, never, Scope>
```

Normalization rules:

- **`Subscribable`** → returned by reference, no new ref or fiber
- **Static value** → `get` succeeds immediately; `changes` emits once
- **`Effect`** → memoized via `Effect.cached`; `changes` emits the resolved value once
- **`Stream`** → forks a scoped pump fiber that drains into a `SubscriptionRef`; `get` awaits the first emission

The pump fiber is tied to the enclosing scope via `Effect.forkScoped` — it terminates when the scope closes.

### `NoPropValue`

Tagged error raised when a `Stream` prop ends before emitting a value:

```typescript
class NoPropValue extends Data.TaggedError("NoPropValue")<{
  readonly key?: string;
}> {}
```

The `key` field identifies which prop triggered the error when provided.

### `PropsE<P>` and `PropsR<P>`

Type-level utilities that extract the `E` and `R` channels from a props object:

```typescript
type PropsE<P> = { [K in keyof P]: P[K] extends Stream.Stream<any, infer E, any> ? E : ... }[keyof P]
type PropsR<P> = { [K in keyof P]: P[K] extends Stream.Stream<any, any, infer R> ? R : ... }[keyof P]
```

These are used internally by `h` and `defineComponent` to accumulate channels from props. You generally don't need to reference them directly unless building utilities over the combinator API.

---

## Constants

### `FRAGMENT`

Internal brand used to mark fragment nodes. Not intended for direct use — use `h.fragment` instead.

---

## Utility functions

### `isStream(value)`

Returns `true` if `value` is a `Stream.Stream`:

```typescript
isStream(value: unknown): value is Stream.Stream<unknown, unknown, unknown>
```

### `toStream(value)`

Normalizes a static value, `Effect`, or `Stream` into a `Stream`:

```typescript
toStream<A>(value: A | Effect.Effect<A> | Stream.Stream<A>): Stream.Stream<A>
```

- Static value → `Stream.make(value)` (single emission)
- `Effect` → `Stream.fromEffect(effect)` (one-shot)
- `Stream` → returned as-is

### `isSubscribable(value)`

Returns `true` if `value` implements the `Subscribable` interface (keyed off `Subscribable.TypeId`):

```typescript
isSubscribable(value: unknown): value is Subscribable<unknown, unknown, unknown>
```
