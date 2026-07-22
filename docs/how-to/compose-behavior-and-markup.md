---
title: Compose Behavior and Markup
order: 13
section: how-to
description: "Use Props.merge to combine a behavior prop bag with your own markup: chained handlers, ref fan-out, and reactive classes on one element."
---

# Compose Behavior and Markup

`Props.merge` combines a behavior's prop bag (aria wiring, handlers, refs, reactive state) with markup you own, without either side losing what it contributed.

## The problem

Object spread can't combine two prop bags safely:

```ts
const merged = { ...behavior, ...mine };
// mine.onclick replaces behavior.onclick entirely, and mine.ref replaces
// behavior.ref entirely. Nothing warns you.
```

`Props.merge` reconciles the collision per key instead of silently dropping a side.

## Behavior as a prop bag

A behavior primitive is a plain Effect that yields a prop bag. There's no component wrapper and no hook rules, so you `yield*` it anywhere and hold the result:

```ts
import { Effect, Option, Stream, SubscriptionRef } from "effect";

const makeDisclosure = () =>
  Effect.gen(function* () {
    const isOpen = yield* SubscriptionRef.make(false);
    const anchor = yield* SubscriptionRef.make(Option.none<HTMLElement>());

    const trigger = {
      ref: anchor,
      // A boolean value renders as presence-only (`setAttribute(name, "")`),
      // which is wrong for `aria-*`. Map to the literal string instead.
      "aria-expanded": Stream.map(SubscriptionRef.changes(isOpen), (open) =>
        open ? ("true" as const) : ("false" as const),
      ),
      onclick: () => SubscriptionRef.update(isOpen, (open) => !open),
    };

    return { isOpen, trigger };
  });
```

`makeDisclosure` returns a plain object, not a `DomProps`-typed value. `merge` accepts it as-is: it dispatches on each key's name, not on the bag's declared type.

## Merge onto your element

You write the element; the bag merges onto it:

```ts
import { h } from "@weftui/core";
import { Props } from "@weftui/dom";

const Panel = () =>
  Effect.gen(function* () {
    const disclosure = yield* makeDisclosure();
    const measure = yield* SubscriptionRef.make(Option.none<HTMLElement>());

    return yield* h.button(
      Props.merge(disclosure.trigger, {
        class: Props.cx("btn", { "btn--open": SubscriptionRef.changes(disclosure.isOpen) }),
        onclick: (ev: MouseEvent) => trackClick(ev),
        ref: measure,
      }),
      "Details",
    );
  });
```

- **Handlers chain.** The disclosure toggles, then `trackClick` runs; a failure in one never blocks the other.
- **Refs fan out.** `anchor` and `measure` both receive the element; spread would have kept only one.
- **`class` takes a reactive condition.** `btn--open` follows `isOpen` through `Props.cx`.

Type an inline handler's event explicitly (`(ev: MouseEvent)` above). `merge` doesn't know which element the bag will land on, so it can't infer it.

## Per-key rules

| Key           | Rule                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------- |
| `on*`         | Chained left to right. Both bodies run; failures from both sides are aggregated.             |
| `class`       | Concatenated. All-static stays a `string`; either side reactive makes it a `Stream<string>`. |
| `style`       | Two per-property objects merge per key, right wins. Any other shape is last-wins.            |
| `ref`         | Fan out: concatenates into an array, and every ref receives the element.                     |
| anything else | Last-wins.                                                                                   |

```ts
Props.merge({ style: { color: "red" } }, { style: { fontWeight: "bold" } });
// => { style: { color: "red", fontWeight: "bold" } }
```

A key present on only one side passes through untouched.

## Typed errors and services flow through

A handler that fails with a tagged error, or needs a service, keeps both channels through the merge. They surface on the component's `Node<E, R>`, so the app must provide the service and can catch the error at a boundary:

```ts
declare const rowBehavior: object;
declare const itemId: string;

const deleteItem = Effect.gen(function* () {
  const files = yield* FileService;
  yield* files.remove(itemId);
});

// The merged node requires FileService and can fail with whatever error
// `files.remove` declares. Both channels flow through `merge` untouched.
h.button(Props.merge(rowBehavior, { onclick: () => deleteItem }), "Delete");
```

## Two gotchas that differ from spread

- **`false` on a handler is an explicit opt-out and wins.** `null`/`undefined` mean "not provided", so the other side survives instead:

  ```ts
  Props.merge({ onclick: () => track() }, { onclick: false }); // handler is off
  ```

- **Every other key is genuinely last-wins.** Forwarding an omitted optional prop (`{ id: props.id }`) still overwrites a default with `undefined`, the same as `{ ...base, ...override }` would. Guard at the call site if that matters.

The [reference](../reference/dom.md#propsmerge) has the full per-key rule table, including the `style` and reactive-class cases above.

## Complete example

A disclosure behavior merged onto a caller-owned button, with a click counter and a ref the behavior doesn't know about. This is the whole file set, copy/paste runnable in a `vite` + `@weftui/core`/`@weftui/dom` project.

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Compose behavior and markup demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```typescript
// src/app.ts
/**
 * Disclosure behavior (open state, anchor ref, toggle handler) merged onto a
 * button the caller owns: its own class, its own click counter, its own ref.
 * Side-effect-free (no mount call), so `main.ts` and any test can import
 * `App` directly.
 */
import { h } from "@weftui/core";
import { Props } from "@weftui/dom";
import { Effect, Option, Stream, SubscriptionRef } from "effect";

const makeDisclosure = () =>
  Effect.gen(function* () {
    const isOpen = yield* SubscriptionRef.make(false);
    const anchor = yield* SubscriptionRef.make(Option.none<HTMLElement>());

    const trigger = {
      ref: anchor,
      "aria-expanded": Stream.map(SubscriptionRef.changes(isOpen), (open) =>
        open ? ("true" as const) : ("false" as const),
      ),
      onclick: () => SubscriptionRef.update(isOpen, (open) => !open),
    };

    return { isOpen, trigger };
  });

export const App = () =>
  Effect.gen(function* () {
    const disclosure = yield* makeDisclosure();
    const measure = yield* SubscriptionRef.make(Option.none<HTMLElement>());
    const clicks = yield* SubscriptionRef.make(0);

    return yield* h.div({ id: "app" }, [
      h.button(
        Props.merge(disclosure.trigger, {
          class: Props.cx("btn", { "btn--open": SubscriptionRef.changes(disclosure.isOpen) }),
          onclick: () => SubscriptionRef.update(clicks, (n) => n + 1),
          ref: measure,
        }),
        "Details",
      ),
      h.p([
        "clicked ",
        Stream.map(SubscriptionRef.changes(clicks), String),
        " times · ref fan-out: ",
        Stream.map(SubscriptionRef.changes(measure), (captured) =>
          Option.isSome(captured) ? "captured" : "pending",
        ),
      ]),
    ]);
  });
```

```typescript
// src/main.ts
/**
 * Browser entry: mounts the demo into #root.
 */
import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root")!;

const app = WeftApp.make();
void Effect.runPromise(WeftApp.mount(app, App(), root));
```

## When to use

Reach for `Props.merge` when two parties contribute props to one element: a shared behavior and a caller, or a base variant and a caller's override. For a single bag you already control, write the object directly. Merge only earns its cost when a key could collide.

`Props.merge` is pure: calling it has no side effects and subscribes nothing. A merged `class` that turns out reactive is a `Stream` description, not a live subscription. The renderer subscribes it once the element mounts, the same as any other reactive prop.

## See also

- [Headless Menu example](../../examples/headless-menu): a full behavior primitive (`Menu.trigger`/`popup`/`item`) merged onto consumer-owned markup, with handler chaining, ref fan-out, and a service requirement flowing through the merge into `Node<E, R>`.
- [`@weftui/dom` reference](../reference/dom.md): the full per-key rules and `cx` grammar
- [Use Element Refs](./use-element-refs.md): the single-ref contract that fan-out builds on
- [Style Reactively](./style-reactively.md): per-property style streams and `cx`
- [The Combinator API](../explanation/combinator-api.md): why elements are plain data you always own
