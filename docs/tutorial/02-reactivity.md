---
title: Reactivity
order: 2
section: tutorial
description: Add component-local state with SubscriptionRef and weave its stream of changes into the tree so the DOM updates in place.
---

# Reactivity

[Previously](./01-your-first-app.md) you mounted a static counter shell. Now wire it up. This is the defining move in Weft: **weave a stream through the tree, and only that point updates.**

## Wire up the counter

Use Effect's `SubscriptionRef` for component-local state. `SubscriptionRef.changes(ref)` returns a `Stream` that emits the current value and then every update. Pass that stream (or a derived stream) as a child and the DOM at that spot becomes live. Replace `src/app.ts`:

```typescript
// src/app.ts
import { h } from "@weftui/core";
import { Effect, Stream, SubscriptionRef } from "effect";

export const App = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    const label = Stream.map(SubscriptionRef.changes(count), (n) => `Count: ${n}`);

    return yield* h.div({ class: "app" }, [
      h.h1("Weft Counter"),
      h.p({ class: "count" }, [label]),
      h.div({ class: "controls" }, [
        h.button(
          { type: "button", onclick: () => SubscriptionRef.update(count, (n) => n - 1) },
          "−",
        ),
        h.button(
          { type: "button", onclick: () => SubscriptionRef.update(count, (n) => n + 1) },
          "+",
        ),
      ]),
    ]);
  });
```

`main.ts` and `index.html` don't change. Reload and the buttons work.

## Why this works

`App`'s body runs **exactly once**: it creates the ref, builds the tree, and returns. Nothing re-invokes it afterward. The only thing that changes the DOM is the `label` stream woven into `h.p`.

Click `+` and `SubscriptionRef.update` pushes a new value, `label` emits `"Count: 1"`, and the renderer patches _just that paragraph's text_ in place. No diff, no re-render, no sibling touched.

`label` also shows **deriving values**: because `SubscriptionRef.changes(count)` is a `Stream`, you shape reactive text with ordinary stream operators (`Stream.map` here) instead of a templating syntax. Anywhere you'd compute a derived value, map the stream.

> **Note.** A stream-shaped child or prop is reactive; a static value (`"Hello"`, `5`) is not and never changes. `h.h1("Weft Counter")` above is static for exactly that reason. The rule is uniform across the whole tree.

The full model is [The Rendering Model](../explanation/rendering-model.md); the vocabulary of stream-shaped values is [Reactive Primitives](../explanation/reactive-primitives.md).

## Next

- [Services and Async →](./03-services-and-async.md): read services from a button handler and load data asynchronously
