# Combinator API

## Overview

A typed tree-building API that preserves Effect's `E` and `R` channels through the template structure. `Node<E, R>` IS `Effect.Effect<DOMNode, E, R>`, so requirements and errors accumulate through the full tree and are visible to the type system end-to-end. Three building blocks make up the surface:

- `h.<tag>(...)` — HTML, SVG, and user-extended custom elements via a proxy namespace.
- `h.fragment(children)` — group children without a wrapping element.
- `Component.gen` / `Component.make` — factories for custom components.

---

## Design decisions

### Node IS an Effect

`Node<E, R>` is a type alias for `Effect.Effect<DOMNode, E, R>`. This means:

- `yield* h.div(...)` works natively in `Effect.gen` and propagates `R`.
- `() => h.div(...)` preserves `R` on the return type.
- All Effect combinators (`Effect.provide`, `Effect.map`, `pipe`, etc.) work on nodes.
- No parallel type system — nodes are first-class Effects.

### Plain config objects for everything

Both HTML elements and custom components take a plain props object. No attr-function pattern (`className("foo")`), no separate attr namespace. Consistent call signature across the entire API:

```ts
h.div({ class: "container" }, [
  h.span({ class: "title" }, "Hello"),
  TextField({ name: "email", value: userStream }),
]);
```

`E` and `R` are extracted from reactive prop values (Stream, Effect, Subscribable) via mapped types — no special wrapper needed. When a prop value is a plain string/number/function, it contributes `never` to both channels.

### `h` namespace for HTML elements

All intrinsic elements live under `h` to avoid polluting the local scope and to make the element/component distinction visually clear at a glance:

```ts
h.div, h.span, h.input, h.button, h.form, ...
```

Custom components are imported and called directly without a namespace prefix. The `h` proxy lazily creates and caches an `ElementFn` per tag — repeat accesses return the same function reference. `makeH(cache?)` is exposed for tests that need an isolated cache.

### Effects and Streams are children directly

`Child` includes `Effect.Effect<unknown, any, any>` and `Stream.Stream<unknown, any, any>` (alongside primitives, other `Node`s, `null`/`undefined`, and `Iterable<Child>`). There is no `node()` lifting helper — `E`/`R` propagate from these children automatically.

```ts
h.div({}, [userStream, dbEffect, h.span({}, "static")]);
//  ^? Node<DbError, UserService | DbService>
```

### Element call shapes

`ElementFn` supports multiple call shapes; each preserves the caller's prop and child `E`/`R`:

- `el(props, children)` — props plus a `readonly Child[]`.
- `el(props, child)` — props plus a single `string | number`.
- `el(props)` — props only.
- `el(children)` — children only.
- `el(child)` — single `string | number`.
- `el()` — empty.

### `Component.gen` and `Component.make`

Two factories with identical semantics, differing only in body shape:

```ts
const TextField = Component.gen(function* (props: TextFieldProps) {
  return yield* h.input({ name: props.name, value: props.value });
});

const Avatar = Component.make((props: { src: string }) => h.img({ src: props.src, alt: "" }));
```

The returned function is generic over the caller's specific `GenP extends BaseProps`, so the caller's reactive prop values contribute additional `E`/`R` at the call site. The component's own internal `E`/`R` (from the body) unions in. No `Prop.fn()` / `Prop.source()` descriptor system — plain TypeScript interfaces handle both value and function props.

### Children: array or function

Components accept an optional `children` argument typed as:

```ts
type Children<Input = never> = readonly Child[] | ((input: Input) => readonly Child[]);
```

- **Array children** — the common case; flows straight into the body.
- **Function children** — render-prop / slot pattern. The component invokes the function with whatever input it chooses (a scoped value, an id, an iteration item) and uses the returned array.

For function-children, `ChildrenE`/`ChildrenR` are extracted from the function's `ReturnType`, not from the function itself.

```ts
const List = Component.make(
  (props: { items: readonly string[] }, renderItem: (item: string) => readonly Child[]) =>
    h.ul({}, props.items.flatMap(renderItem)),
);

List({ items: ["a", "b"] }, (item) => [h.li({}, item)]);
```

### `toView` / headless pattern — deferred

Foldkit-inspired pattern where a component exposes its managed attributes (aria, role, event bindings) to the caller, who decides the actual element:

```ts
Button({
  onClick: handleSave,
  toView: (attrs) => h.button({ ...attrs.button, class: "btn" }, ["Save"]),
});
```

The component owns behaviour and accessibility; the caller owns structure and style. `toView` returning a `Node<E, R>` means `R` from the caller's render function flows into the component's type naturally. Deferred until function-children patterns have settled in real apps.

---

## Acceptance criteria

### Core type accumulation

- `Node<E, R>` must be assignable to `Effect.Effect<DOMNode, E, R>`.
- Reactive prop values (Stream, Effect, Subscribable) contribute their `E` and `R` to the node.
- Effect/Stream children embedded directly in the children array contribute their `E` and `R`.
- `E` and `R` accumulate across sibling children (union).
- `E` and `R` propagate through arbitrary nesting depth.
- Reactive props and reactive children both contribute — unioned together.

### Components

- `Component.gen` / `Component.make` body `E`/`R` are inferred from the returned/yielded effects and fixed at definition time.
- Caller's reactive prop values contribute additional `E`/`R` at the call site.
- The optional `children` argument may be `readonly Child[]` or a `(input) => readonly Child[]` function; for the function form, `E`/`R` are extracted from the function's return type.
- Total `E`/`R` is the union of body, caller-props, and caller-children channels.
- Static prop values (`string`, `number`, `() => void`) contribute `never`.

### Element call shapes

- `h.div({}, ["a"])` — `Node<never, never>`.
- `h.div({})` — `Node<never, never>`, no `children` key on the resulting `DOMNode`.
- `h.div(["a"])` — children only, empty props.
- `h.div({}, "a")` — single primitive child.
- `h.div()` — `Node<never, never>`.
- The `h` proxy returns identity-equal `ElementFn`s for repeated accesses of the same tag.

### Compatibility

- `() => h.div(...)` — plain function wrapper preserves `R` on the return type.
- `Effect.gen(function* () { return yield* h.div(...) })` — `yield*` works, `R` propagates into the generator's context channel.
- `Effect.provide(h.div(...), layer)` — standard Effect combinators work on nodes.

### Invalid uses (must not compile)

- Arbitrary objects, bare functions, and symbols are not valid `Child` values.
- A component declared with array children rejects function children at the call site (and vice versa).
- Function-children with the wrong return type (e.g. returning a string) is rejected.

---

## API surface

```ts
// Core types
type Node<E = never, R = never> = Effect.Effect<DOMNode, E, R>;

type Child =
  | Node<any, any>
  | Stream.Stream<unknown, any, any>
  | Effect.Effect<unknown, any, any>
  | string | number | bigint | boolean
  | null | undefined
  | Iterable<Child>;

// E/R extraction (internal but exported for type-level work)
type PropsE<P>, PropsR<P>;
type ChildrenE<T extends readonly Child[]>, ChildrenR<T extends readonly Child[]>;

// Element namespace
interface ElementFn<Props> {
  <P extends Props, C extends readonly Child[]>(props: P, children: C):
    Node<PropsE<P> | ChildrenE<C>, PropsR<P> | ChildrenR<C>>;
  <P extends Props>(props: P, child: string | number): Node<PropsE<P>, PropsR<P>>;
  <P extends Props>(props: P): Node<PropsE<P>, PropsR<P>>;
  <C extends readonly Child[]>(children: C): Node<ChildrenE<C>, ChildrenR<C>>;
  (): Node<never, never>;
}

declare const h: { [Tag in keyof (HTMLElements & SVGElements & CustomElements)]: ElementFn<...> };
declare function makeH(cache?: Map<string, ElementFn<any>>): typeof h;
declare function h.fragment<C extends readonly Child[]>(children: C):
  Node<ChildrenE<C>, ChildrenR<C>>;

// Components
namespace Component {
  type Children<Input = never> = readonly Child[] | ((input: Input) => readonly Child[]);

  type Component<P, C extends Children, E, R> = <GenP extends P, GenC extends C>(
    props: GenP,
    children?: GenC,
  ) => Node<
    PropsE<GenP> | ChildrenE<GenC extends (...a: any[]) => any ? ReturnType<GenC> : GenC> | E,
    PropsR<GenP> | ChildrenR<GenC extends (...a: any[]) => any ? ReturnType<GenC> : GenC> | R
  >;

  function gen<BaseProps, C extends Children>(
    f: (props: BaseProps, children: C) => Generator<...>,
  ): Component<BaseProps, C, E, R>;

  function make<BaseProps, C extends Children>(
    f: (props: BaseProps, children: C) => Effect<DOMNode, E, R>,
  ): Component<BaseProps, C, E, R>;
}
```

---

## What's next

- **`toView` / headless pattern** — `toView: (attrs: ButtonAttrs) => Node<E, R>` prop for components that expose their managed attributes to the caller.
- **Per-element typed children** — narrow `Child` per tag (e.g. `<select>` may only contain `<option>` / `<optgroup>`) once the function-children pattern has been exercised in real apps.
- **Custom component scopes** — typed child vocabulary per component; enables `Dialog.Root` / `Dialog.Content` slot patterns built on top of function-children.
