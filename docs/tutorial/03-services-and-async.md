---
title: Services and Async
order: 3
section: tutorial
description: Give handlers access to services from the environment, and render async loading states by returning a Stream of nodes.
---

# Services and Async

[So far](./02-reactivity.md) the counter's state has been self-contained. Real apps talk to services and wait on async work. Both fall out of the same fact (a `Node` is an `Effect`), so both use plain Effect. This step adds a logging service to the buttons and an async fact panel below the counter.

## Handlers that use services

An event handler can **return an Effect**. That Effect runs in the app's environment, so it can read any service the app's layer provides:

```typescript
import { Context, Effect, Layer } from "effect";

class Logger extends Context.Service<
  Logger,
  { log: (message: string) => Effect.Effect<void> }
>()("Logger") {}

const LoggerLive = Layer.succeed(Logger, {
  log: (message) => Effect.sync(() => console.log(message)),
});
```

Wire it into the counter's `step` handler, so every click logs before updating state:

```typescript
const step = (delta: number) =>
  Effect.gen(function* () {
    const logger = yield* Logger;
    yield* SubscriptionRef.update(count, (n) => n + delta);
    yield* logger.log(`count changed by ${delta}`);
  });
```

`Logger` entered the tree's requirement channel the moment `step` read it. You'll discharge it **once**, by passing `LoggerLive` to `WeftApp.make`. Provide too little and it's a compile error. Services come exclusively from the app's layer: an `Effect.provide` wrapped around the `mount` call does **not** reach components or handlers. This is Weft's entire dependency-injection story; it's just Effect's. The deeper treatment is [Services and Context](../explanation/services-and-context.md).

## Async loading states

A component can return a **`Stream<Node>`** to show different content over time. Sequence a loading placeholder before the resolved content with `Stream.concat`:

```typescript
const fetchFact = (n: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep("800 millis");
    return `${n} is ${n % 2 === 0 ? "even" : "odd"}.`;
  });

const NumberFact = ({ n }: { n: number }) =>
  Stream.concat(
    Stream.make(h.p({ class: "fact" }, "Loading a fact…")),
    Stream.fromEffect(Effect.map(fetchFact(n), (fact) => h.p({ class: "fact" }, fact))),
  );
```

The stream emits the loading node first, then the resolved node. The renderer swaps the DOM in place on the second emission. This is the raw mechanism; to coordinate _several_ async regions with one fallback, reach for [`Boundary.suspend`](../explanation/boundaries-and-suspense.md).

## Put it together

Replace `src/app.ts`, adding both pieces as part of the same tree:

```typescript
// src/app.ts
import { h } from "@weftui/core";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";

export class Logger extends Context.Service<
  Logger,
  { log: (message: string) => Effect.Effect<void> }
>()("Logger") {}

export const LoggerLive = Layer.succeed(Logger, {
  log: (message) => Effect.sync(() => console.log(message)),
});

const fetchFact = (n: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep("800 millis");
    return `${n} is ${n % 2 === 0 ? "even" : "odd"}.`;
  });

const NumberFact = ({ n }: { n: number }) =>
  Stream.concat(
    Stream.make(h.p({ class: "fact" }, "Loading a fact…")),
    Stream.fromEffect(Effect.map(fetchFact(n), (fact) => h.p({ class: "fact" }, fact))),
  );

export const App = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    const label = Stream.map(SubscriptionRef.changes(count), (n) => `Count: ${n}`);

    const step = (delta: number) =>
      Effect.gen(function* () {
        const logger = yield* Logger;
        yield* SubscriptionRef.update(count, (n) => n + delta);
        yield* logger.log(`count changed by ${delta}`);
      });

    return yield* h.div({ class: "app" }, [
      h.h1("Weft Counter"),
      h.p({ class: "count" }, [label]),
      h.div({ class: "controls" }, [
        h.button({ type: "button", onclick: () => step(-1) }, "−"),
        h.button({ type: "button", onclick: () => step(1) }, "+"),
      ]),
      NumberFact({ n: 3 }),
    ]);
  });
```

Give the app the layer in `src/main.ts`:

```typescript
// src/main.ts
import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App, LoggerLive } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

const app = WeftApp.make(LoggerLive);
void Effect.runPromise(WeftApp.mount(app, App(), root));
```

Reload: the fact panel shows "Loading a fact…" then swaps in, and every click logs to the console.

## Next

- [Errors and Server Rendering →](./04-errors-and-server.md): catch the fact panel's failures with a boundary and render the whole app on the server
