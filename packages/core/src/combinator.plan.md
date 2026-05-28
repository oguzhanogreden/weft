# Combinator API — Implementation Plan

## Context

effect-ui's JSX runtime loses Effect's `E` and `R` type channels at every `JSX.Element` boundary — a hard TypeScript limitation. The combinator API is a typed alternative: a tree-building DSL where `Node<E, R>` IS `Effect.Effect<DOMNode, E, R>`, so requirements and errors accumulate through the tree and are visible to the type system end-to-end.

This plan implements the API surface and types. Runtime rendering (DOM patching, reactive subscriptions, scope/layer management) is out of scope here.

Design decisions from the conversation:

- Plain config objects for everything — HTML elements and custom components use the same call shape
- `h` is a Proxy + `Map` cache — no hand-maintained list of 150+ element functions
- Custom elements via `CustomElements` interface augmentation
- No `node()` escape hatch — children accept Stream/Effect/primitives directly, same as JSXNode
- `defineComponent` factory — makes R propagation from caller props automatic without requiring authors to write generic signatures and `as` casts manually

---

## Files

### New: `packages/core/src/combinator/`

**`types.ts`** — core types and E/R extraction helpers

```ts
import { Effect, Stream, Subscribable } from "effect";

// Opaque rendered element (no DOM lib dependency for now)
export interface DOMNode {
  readonly _tag: "DOMNode";
}

// Node IS an Effect — yield*, Effect.gen, pipe all work natively
export type Node<E = never, R = never> = Effect.Effect<DOMNode, E, R>;

// Valid child types — mirrors JSXNode: Node, Stream, Effect, primitives, null/undefined
export type Child =
  | Node<any, any>
  | Stream.Stream<unknown, any, any>
  | Effect.Effect<unknown, any, any>
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

// E/R extraction from a props object
// Stream, Effect, Subscribable prop values contribute their channels; static/function values contribute never
export type PropsE<P> = {
  [K in keyof P]: P[K] extends Stream.Stream<any, infer E, any>
    ? E
    : P[K] extends Effect.Effect<any, infer E, any>
      ? E
      : P[K] extends Subscribable.Subscribable<any, infer E, any>
        ? E
        : never;
}[keyof P];

export type PropsR<P> = {
  [K in keyof P]: P[K] extends Stream.Stream<any, any, infer R>
    ? R
    : P[K] extends Effect.Effect<any, any, infer R>
      ? R
      : P[K] extends Subscribable.Subscribable<any, any, infer R>
        ? R
        : never;
}[keyof P];

// E/R extraction from a children array — handles Node (Effect), Stream, and Effect directly
export type ChildrenE<T extends readonly Child[]> = {
  [K in keyof T]: T[K] extends Effect.Effect<any, infer E, any>
    ? E
    : T[K] extends Stream.Stream<any, infer E, any>
      ? E
      : never;
}[number];

export type ChildrenR<T extends readonly Child[]> = {
  [K in keyof T]: T[K] extends Effect.Effect<any, any, infer R>
    ? R
    : T[K] extends Stream.Stream<any, any, infer R>
      ? R
      : never;
}[number];

// Per-element call signature (4 overloads)
export type ElementFn<Props> = {
  // props + children array
  <P extends Props, C extends readonly Child[]>(
    props: P,
    children: C,
  ): Node<PropsE<P> | ChildrenE<C>, PropsR<P> | ChildrenR<C>>;
  // props + single static child
  <P extends Props>(props: P, child: string | number): Node<PropsE<P>, PropsR<P>>;
  // props only
  <P extends Props>(props: P): Node<PropsE<P>, PropsR<P>>;
  // children only, no props
  <C extends readonly Child[]>(children: C): Node<ChildrenE<C>, ChildrenR<C>>;
};

// Strip children from HTML prop types — children are the second arg, not a prop key
export type CombinatorialProps<P> = Omit<P, "children">;
```

**`element.ts`** — `h` proxy + cache

```ts
import { Effect } from "effect";
import type { HTMLElements, SVGElements } from "~/types";
import type { DOMNode, Node, ElementFn, CombinatorialProps } from "./types";

// Augmentable interface for user-defined custom element tags + props
export interface CustomElements {}

// Full h type: HTML + SVG + custom, with children stripped from props
type H = { [K in keyof HTMLElements]: ElementFn<CombinatorialProps<HTMLElements[K]>> } & {
  [K in keyof SVGElements]: ElementFn<CombinatorialProps<SVGElements[K]>>;
} & { [K in keyof CustomElements]: ElementFn<CustomElements[K]> };

function createElementFn(tag: string): ElementFn<any> {
  return (..._args: unknown[]): Node<any, any> =>
    // Stub — real rendering wired later
    Effect.succeed({ _tag: "DOMNode" } as DOMNode);
}

// Map cache — strings as keys, WeakMap not applicable here
const cache = new Map<string, ElementFn<any>>();

export const h = new Proxy({} as H, {
  get(_, tag: string) {
    let fn = cache.get(tag);
    if (!fn) {
      fn = createElementFn(tag);
      cache.set(tag, fn);
    }
    return fn;
  },
});
```

**`component.ts`** — `defineComponent`

```ts
import type { Node, PropsE, PropsR } from "./types";

export function defineComponent<BaseProps, CompE, CompR>(
  render: (props: BaseProps) => Node<CompE, CompR>,
): <P extends BaseProps>(props: P) => Node<PropsE<P> | CompE, PropsR<P> | CompR> {
  return (props) => render(props) as any;
}
```

The returned function is generic over `P extends BaseProps` — TypeScript infers the caller's specific reactive prop values and `PropsE<P>` / `PropsR<P>` extract E/R from them. The component's own internal E/R (from its render function) unions with the caller's contribution.

**`index.ts`** — barrel

```ts
export { h } from "./element";
export type { CustomElements } from "./element";
export { defineComponent } from "./component";
export type {
  Node,
  DOMNode,
  Child,
  ElementFn,
  PropsE,
  PropsR,
  ChildrenE,
  ChildrenR,
} from "./types";
```

### Modify: `packages/core/src/combinator.ts`

Replace `declare` mocks with real imports from the implementation, keeping all tests:

```ts
import { h, defineComponent } from "./combinator";
import { Effect, Stream } from "effect";
// ... same test cases, with node() calls replaced by direct Stream/Effect children
```

All `Expect<Equal<...>>` type assertions must still pass.

### Modify: `packages/core/src/index.ts`

```ts
export { h, defineComponent } from "./combinator";
export type { Node, CustomElements } from "./combinator";
```

---

## Key reuse from existing codebase

- **`HTMLElements`** (`src/types/html/html.ts`) — `tag → AttributesInterface<ElementType>` map, 150+ elements. Used directly as the HTML portion of `H`. No codegen needed.
- **`SVGElements`** (`src/types/html/svg.ts`) — same pattern, 40+ SVG elements.
- **`HTMLAttributeSource<T>`** (`src/types/html/attributes.ts`) = `Source.Source<T | undefined>` — attribute values already typed for reactivity. `PropsE`/`PropsR` correctly extracts from these since `Source<T,E,R>` includes Stream/Effect/Subscribable.
- **`Source.toSubscribable`** (`src/source.ts`) — used in the renderer (out of scope) to normalize reactive prop values.

---

## Custom components

```ts
interface TextFieldProps {
  name: string;
  value?: string | Stream.Stream<string, any, any>;
  onChange?: (value: string) => void;
}

const TextField = defineComponent<TextFieldProps, never, never>(({ name }) =>
  h.div({ className: "field" }, [h.input({ name })]),
);

// Caller's reactive prop value contributes R automatically
TextField({ name: "email", value: userStream });
// → Node<never, UserService>

TextField({ name: "email", value: "static@example.com" });
// → Node<never, never>
```

The factory's generic return type `<P extends BaseProps>` means TypeScript infers the specific Stream/Effect passed at the call site. No generic signatures or `as` casts required from component authors.

---

## Custom elements

```ts
// app/types.d.ts
declare module "effect-ui" {
  interface CustomElements {
    "x-button": { variant: "primary" | "ghost"; label: string };
  }
}

h["x-button"]({ variant: "primary", label: "Submit" }); // ✓
h["x-button"]({ variant: "invalid" }); // type error
```

---

## Children without node()

Streams and Effects are valid children directly, same as JSXNode:

```ts
h.div({}, [
  h.span({}, "Hello"),
  userStream, // Stream<string, never, UserService> — R extracted
  dbEffect, // Effect<string, DbError, DbService> — E and R extracted
]);
// → Node<DbError, UserService | DbService>
```

---

## Verification

1. Create `src/combinator/` with the four files above
2. Update `src/combinator.ts` tests — replace `declare` mocks with real imports, replace `node(x)` with `x` directly in children arrays
3. All `Expect<Equal<...>>` assertions pass under `vp check`
4. Add a test for `h["x-button"]` with a mock `CustomElements` augmentation — valid props compile, invalid props are a type error
5. `vp check` passes across all files
