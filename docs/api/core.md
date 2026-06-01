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

Each builder has these overloads:

| Signature                               | Description                 |
| --------------------------------------- | --------------------------- |
| `h.tag(props, children: Renderable[])`  | Props + array of children   |
| `h.tag(props, child: string \| number)` | Props + single static child |
| `h.tag(props)`                          | Props only, no children     |
| `h.tag(children: Renderable[])`         | Children only, no props     |
| `h.tag(child: string \| number)`        | Single static child only    |
| `h.tag()`                               | No arguments                |

**Return type**: `Node<PropsE<P> | ChildrenE<C>, PropsR<P> | ChildrenR<C>>`

Reactive prop values (Stream, Effect, Subscribable) contribute their `E`/`R` to the node. Static values contribute `never`. Children's channels are unioned with props' channels.

### `h.fragment`

Groups children into a fragment that renders without a wrapper element:

```typescript
import { h } from "@effect-ui/core";

h.fragment(children: Node[]): Node<ChildrenE, ChildrenR>
```

Use when a component needs to return multiple sibling elements.

### `Component`

Namespace exposing two factories for reusable components with caller-propagating reactive prop types: `Component.gen` (generator body) and `Component.make` (plain-function body). Both return a callable that is generic over the caller's specific `props`/`children`, so reactive prop values and reactive children contribute their `E`/`R` at the call site.

```typescript
import { Component } from "@effect-ui/core";

Component.gen<BaseProps, C>(
  body: (props: BaseProps, children: C) => Generator<YieldedEffect, ElementDescriptor, never>
): <GenP extends BaseProps, GenC extends C>(
  props: GenP,
  children?: GenC,
) => Node<PropsE<GenP> | ChildrenE<…> | BodyE, PropsR<GenP> | ChildrenR<…> | BodyR>;

Component.make<BaseProps, C>(
  body: (props: BaseProps, children: C) => Effect<ElementDescriptor, E, R>
): /* same call signature as above */;
```

**`Children`** — the optional `children` argument may be either form:

```typescript
type Component.Children<Input = never> =
  | readonly Renderable[]
  | ((input: Input) => readonly Renderable[]);
```

For function-children, `ChildrenE`/`ChildrenR` are extracted from the function's `ReturnType`, not from the function itself. The component's body invokes the function with whatever input it chooses.

**Example — `Component.gen`**:

```typescript
interface TextFieldProps {
  value?: Source.Source<string>;
  onChange?: (v: string) => void;
}

const TextField = Component.gen(function* (props: TextFieldProps) {
  const value = yield* Source.toSubscribable(props.value);
  return yield* h.input({
    value,
    oninput: (e) => props.onChange?.(e.currentTarget.value),
  });
});
```

**Example — `Component.make` with function-children**:

```typescript
const ItemList = Component.make(
  (props: { items: readonly string[] }, children: (item: string) => readonly Renderable[]) =>
    h.ul({}, props.items.flatMap(children)),
);

ItemList({ items: ["a", "b"] }, (item) => [h.li({}, item)]);
```

### `Suspense`

Boundary component that shows a fallback while async children are pending:

```typescript
import { Suspense } from "@effect-ui/core";

Suspense(
  props: { fallback?: Renderable },
  children: Node[]
): Node<ChildrenE, ChildrenR>
```

- Shows `fallback` while any registered child has not yet emitted its first value
- Performs a single atomic DOM swap once all children have settled
- Works on both the server (streaming patch model) and the client
- `hydrate()` sees through `Suspense` boundaries and adopts resolved DOM in place

### `Boundary` namespace

Six variants for intercepting rendering-path errors in a subtree. Each returns a descriptor that the renderer processes via the same `{ type, props }` branch as `Suspense`. All variants share the same call shape — props first, children array second.

**What is caught:**

- Construction-time failures — the Effect phase of building child nodes
- Post-mount stream failures — streams driving children or prop values that fail after mount

**What is NOT caught:** event handler errors (they run in detached fibers outside the render path).

```typescript
import { Boundary } from "@effect-ui/core";
```

#### `Boundary.catchAll`

Catches all typed failures (`Cause.fail`). Defects (`Cause.die`) are not caught and re-raise.

```typescript
Boundary.catchAll<C, FE, FR>(
  props: { fallback: (e: ChildrenE<C>) => Node<FE, FR> },
  children: C,
): Node<FE, ChildrenR<C> | FR>
```

The children's `E` is fully consumed. The output `E` is only the fallback's own error channel.

#### `Boundary.catchAllCause`

Catches every `Cause` including defects and interruptions.

```typescript
Boundary.catchAllCause<C, FE, FR>(
  props: { fallback: (cause: Cause.Cause<ChildrenE<C>>) => Node<FE, FR> },
  children: C,
): Node<FE, ChildrenR<C> | FR>
```

The fallback receives the full `Cause`, not just the failure value.

#### `Boundary.catchTag`

Catches errors whose `_tag` equals `props.tag`. Unmatched errors re-raise to the nearest parent boundary.

```typescript
Boundary.catchTag<C, Tag, FE, FR>(
  props: {
    tag: Tag;                                                    // must be a key of ChildrenE<C>["_tag"]
    fallback: (e: Extract<ChildrenE<C>, { _tag: Tag }>) => Node<FE, FR>;
  },
  children: C,
): Node<Exclude<ChildrenE<C>, { _tag: Tag }> | FE, ChildrenR<C> | FR>
```

The matched tag is removed from the output `E` union.

#### `Boundary.catchTags`

Catches multiple tags in one call. The handlers record IS the first argument (no wrapping object). Unregistered tags re-raise.

```typescript
Boundary.catchTags<C, Handlers>(
  handlers: {
    [Tag in ChildrenE<C>["_tag"]]?: (e: Extract<ChildrenE<C>, { _tag: Tag }>) => Node<any, any>
  },
  children: C,
): Node<UnhandledE | HandlersE, ChildrenR<C> | HandlersR>
```

#### `Boundary.catchSome`

The fallback returns `Option<Node>`. `Option.none()` re-raises the error; `Option.some(node)` catches it.

```typescript
Boundary.catchSome<C, FE, FR>(
  props: { fallback: (e: ChildrenE<C>) => Option.Option<Node<FE, FR>> },
  children: C,
): Node<ChildrenE<C> | FE, ChildrenR<C> | FR>
```

The children's `E` is preserved in the output because the boundary may or may not handle any given error.

#### `Boundary.catchIf`

A predicate gates the fallback. `false` re-raises.

```typescript
Boundary.catchIf<C, FE, FR>(
  props: {
    predicate: (e: ChildrenE<C>) => boolean;
    fallback: (e: ChildrenE<C>) => Node<FE, FR>;
  },
  children: C,
): Node<ChildrenE<C> | FE, ChildrenR<C> | FR>
```

#### Re-raise and nesting

When a boundary's `match` returns `null` (unmatched error), the error propagates to the nearest **parent** `Boundary` via `BoundaryContext`. If there is no parent boundary, the error fails the enclosing mount.

Inner boundaries shadow outer ones for their subtree — the innermost boundary is always tried first.

```typescript
// Inner catches FooError; BarError propagates to outer
Boundary.catchAll({ fallback: (e) => h.div({}, `Outer: ${e.message}`) }, [
  Boundary.catchTag({ tag: "Foo", fallback: (e) => h.span({}, `Foo: ${e.msg}`) }, [
    ChildWithFooOrBarError(),
  ]),
]);
```

---

## Keyed lists

### `List` namespace

The keyed-list combinator. It is the opt-in alternative to wholesale child rebuilds: items are rendered **once per key** and reconciled across emissions, so reordering, inserting, or removing items reuses and moves existing DOM rather than rebuilding the region.

> **Note:** Do not confuse this exported `List` namespace with the `const ItemList = Component.make(...)` example above — that is a user-defined component, not the built-in `List`.

```typescript
import { h, List } from "@effect-ui/core";

h.ul({}, [
  List.each({ of: rows.changes, by: (row) => row.id }, (row) =>
    h.li({}, row.name),
  ),
]);
```

#### `List.each`

Declares a keyed reactive list region.

```typescript
List.each<S extends Source.Source<Iterable<any>, any, any>, CE, CR, K>(
  options: List.Options<S, K>,
  render: (item: ItemOf<S>, index: number) => Node<CE, CR>,
): Node<Source.Error<S> | CE, Source.Context<S> | CR>
```

`render` runs **once per key**; a persisted key keeps its DOM nodes and its running subscription fibers across re-emits (it is never re-invoked). The returned node's `E`/`R` are the union of the source channels and the channels of the node `render` returns.

> **⚠️ Render-once / index-key footgun:** because `render` runs exactly once per key, reconciliation never refreshes a kept row's content — refresh a row by threading a `Stream` **inside** it, not by re-running `render`. Keying by index (`by: (_, i) => i`) reuses rows positionally and will show stale content after a reorder; prefer a stable identity key (`by: (item) => item.id`).

**`List.Options<S, K>`**

```typescript
interface List.Options<S, K> {
  readonly of: S;                                        // static Iterable<T>, or an Effect/Stream/Subscribable of one
  readonly by?: (item: ItemOf<S>, index: number) => K;   // key projection; compared via Effect Equal / Hash
}
```

- **`of`** — the list source. Each emission is materialized to an array to fix order, then reconciled by key.
- **`by`** — projects each item to its reconciliation key. Omitted ⇒ the item itself is the key (structural for `Data`, by reference otherwise).

#### `List.Error<N>` and `List.Context<N>`

Type-level accessors that extract the `E` and `R` channels from a list `Node`. Re-exported from the canonical `Node.Error` / `Node.Context` accessors.

See the `examples/keyed-list` example for a full reconciliation walkthrough (focus, uncontrolled inputs, and per-row counters surviving reorders).

---

## Types

### `Node<E, R>`

```typescript
type Node<E = never, R = never> = Effect.Effect<ElementDescriptor, E, R>;
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

These are used internally by `h` and `Component` to accumulate channels from props. You generally don't need to reference them directly unless building utilities over the combinator API.

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
