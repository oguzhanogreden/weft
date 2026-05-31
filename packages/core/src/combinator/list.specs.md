# List API — `List.each` keyed list combinator

## Overview

`List.each` is the opt-in keyed-list combinator. It declares a reactive region whose
content is a list of items derived from a {@link Source} of `Iterable<T>`, where each
item is rendered **once per key** and reconciled (reused / moved / inserted / removed)
across emissions rather than rebuilt wholesale.

This file specs only the **core combinator surface** (Part B1): the `LIST` detection
symbol, the `List.each` signature, and its `E`/`R` type propagation and identity
semantics. The client reconciliation behaviour (insert/remove/move/reuse, per-item
scopes, LIS moves, hydration) is specified separately in
[`../../../dom/src/client/list.specs.md`](../../../dom/src/client/list.specs.md).

## Design decisions

### Detection via type tag

Like `h.fragment` and `Boundary.*`, `List.each` returns a plain `{ type, props }`
descriptor (built with `elementNode`) whose `type` is the unique `LIST` symbol. The
renderer special-cases this symbol. The node carries `{ of, by, render }` in `props`.

### `of` is a `Source<Iterable<T>>`

`of` accepts the full `Source` vocabulary: a static `Iterable<T>` (Array, `Map`, `Set`,
…), an `Effect<Iterable<T>>`, a `Stream<Iterable<T>>`, or a `Subscribable<Iterable<T>>`.
It normalizes via `Source.toSubscribable`; the reconciler subscribes to `.changes` and
materializes each emission's `Iterable` to an array to fix order.

The item type `T`, the error channel `E`, and the requirement channel `R` are all
extracted from whichever `Source` kind `of` is, via the `SourceValue` / `SourceError` /
`SourceContext` helpers (mirroring `OpenPropSource` / `PropsE` / `PropsR`). A static
`Iterable` contributes `never` to both `E` and `R`.

### `by` is the identity knob

`by?: (item, index) => K` projects an item to a key. Keys are compared with Effect
`Equal` (and hashed with `Hash`), so the reconciler is `O(n)` via a `HashMap`.

- `by` **omitted** → identity is the item itself under `Equal`/`Hash` (structural for
  `Data`, reference for plain objects). Zero-config for `Data` items.
- `by: t => t.id` → stable entity identity (the natural mode).
- `by: (_, i) => i` → positional/index identity — a **footgun**: see render-once below.

`by` is a performance/identity lever, not a correctness fix. `K` defaults to the item
type and is otherwise inferred from `by`'s return type.

### `render` runs once per key

`render: (item, index) => Node<CE, CR>` is invoked **once** when a key first appears.
Its `E`/`R` (`CE`/`CR`) propagate to the returned node. Because components run once, a
persisted key's `render` is **never re-invoked** — reconciliation only reuses/moves/
inserts/removes DOM. Per-item content refresh must be threaded as streams _inside_ the
rendered item.

> ⚠️ **Render-once / index-key footgun.** With `by: (_, i) => i`, nodes are reused
> positionally; on reorder or replace the kept node shows **stale content** unless the
> item is internally reactive — sharper than React's index-key issue (no re-render to
> refresh props). Prefer a stable `by: t => t.id`.

### E/R propagation

The returned `Node`'s channels are the union of the source channels and the render
channels: `Node<SourceError<S> | CE, SourceContext<S> | CR>`. Static `of` + static
`render` ⇒ `Node<never, never>`.

## Acceptance criteria

### Detection

- `List.each(...)` returns a `Node` carrying an `ElementDescriptor` whose `type` is the
  `LIST` symbol and whose `props` are `{ of, by, render }` (`by` may be `undefined`).
- The descriptor is readable via `getElementDescriptor` without executing the Effect.

### Item-type inference

- Static array `of: T[]` ⇒ `render`'s `item` parameter is `T`.
- `of: Stream<T[]>` / `Effect<T[]>` / `Subscribable<T[]>` ⇒ `item` is `T`.
- `Map`/`Set` (or any `Iterable<T>`) ⇒ `item` is `T`.

### E/R propagation

- Static `of` + static `render` ⇒ `Node<never, never>`.
- `of: Stream<T[], E, R>` contributes `E`/`R` to the node.
- `of: Effect<T[], E, R>` / `Subscribable<T[], E, R>` contribute `E`/`R`.
- A reactive child inside `render`'s returned node contributes its `CE`/`CR`.
- Source channels and render channels are unioned on the result.

### `by` typing

- `by` omitted is valid; `K` defaults to the item type.
- `by: (item, index) => K` types `item` as `T` and `index` as `number`.
- `by` does not alter the node's `E`/`R`.

## API surface

```ts
/** Unique symbol identifying keyed-list nodes. */
export const LIST: unique symbol;

export namespace List {
  function each<
    S extends Source.Source<Iterable<any>, any, any>,
    CE = never,
    CR = never,
    K = ItemOf<S>,
  >(
    options: {
      readonly of: S;
      readonly by?: (item: ItemOf<S>, index: number) => K;
    },
    render: (item: ItemOf<S>, index: number) => Node<CE, CR>,
  ): Node<SourceError<S> | CE, SourceContext<S> | CR>;
}
```

## What's next

- Client `renderList` + `reconcileList` (per-item scopes, LIS minimal moves) — see
  `dom/src/client/list.specs.md` (KR/SC ACs).
- Hydration of `List` regions (HY ACs).
- Future: animation/FLIP hooks; a dedicated positional `List.index` variant
  (currently subsumed by `by`).
