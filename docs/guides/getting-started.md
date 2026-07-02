---
title: Getting Started
order: 1
section: guides
description: Build your first Weft app from scratch — components, reactive state, services, async, error boundaries, and an SSR teaser.
---

# Getting Started

This guide walks you through building your first Weft app from scratch.

## Prerequisites

- Node.js (see `package.json` → `engines` for the required version)
- Basic familiarity with [Effect](https://effect.website/docs/getting-started/introduction)

## Install

```bash
npm install @weftui/core @weftui/dom effect
```

## Your first component

The `h` namespace is the entry point for building elements. Each property is a builder for that HTML tag:

```typescript
import { h } from "@weftui/core";
import { mount } from "@weftui/dom/client";
import { Effect } from "effect";

function App() {
  return h.div({ class: "app" }, [h.h1("Hello, Weft"), h.p("A minimal app.")]);
}

void Effect.runPromise(mount(App(), document.getElementById("root")!));
```

`App()` returns a `Node<never, never>` — an `Effect` that resolves to a DOM node. `mount` takes that node and renders it into the target element.

## Adding reactive state

Use `SubscriptionRef` for component-local state. Its `.changes` property is a `Stream<A>` that emits on every update — pass it as a child or prop to get live updates:

```typescript
import { h } from "@weftui/core";
import { mount } from "@weftui/dom/client";
import { Effect, SubscriptionRef } from "effect";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    return yield* h.div([
      h.span([count.changes]),
      h.button({ onclick: () => SubscriptionRef.update(count, (n) => n + 1) }, "+"),
      h.button({ onclick: () => SubscriptionRef.update(count, (n) => n - 1) }, "-"),
    ]);
  });

void Effect.runPromise(mount(Counter(), document.getElementById("root")!));
```

`Effect.gen` lets you `yield*` the `SubscriptionRef` before building the tree. The component function runs **once** — after that, only the streams drive updates.

## Using services

Event handlers can return Effects, which means they have access to any service in the component's environment. Provide services at the `mount` call site:

```typescript
import { h } from "@weftui/core";
import { mount } from "@weftui/dom/client";
import { Context, Effect, Layer } from "effect";

class Logger extends Context.Tag("Logger")<
  Logger,
  { log: (message: string) => Effect.Effect<void> }
>() {}

const LoggerLive = Layer.succeed(Logger, {
  log: (message) => Effect.sync(() => console.log(message)),
});

const LogButton = () =>
  h.button(
    {
      onclick: () =>
        Effect.gen(function* () {
          const logger = yield* Logger;
          yield* logger.log("Button clicked");
        }),
    },
    "Log",
  );

// Provide the layer at mount — all handlers in the tree can access Logger
void Effect.runPromise(
  mount(LogButton(), document.getElementById("root")!).pipe(Effect.provide(LoggerLive)),
);
```

## Async loading states

Components can return a `Stream<Node>` to show different content over time. Use `Stream.concat` to sequence a loading state with the resolved content:

```typescript
import { h } from "@weftui/core";
import { mount } from "@weftui/dom/client";
import { Effect, Stream } from "effect";

const AsyncGreeting = ({ name }: { name: string }) =>
  Stream.concat(
    Stream.make(h.span("Loading...")),
    Stream.fromEffect(
      Effect.gen(function* () {
        yield* Effect.sleep("1 second");
        return yield* h.span(`Hello, ${name}!`);
      }),
    ),
  );

void Effect.runPromise(mount(AsyncGreeting({ name: "World" }), document.getElementById("root")!));
```

## Error boundaries

Wrap any subtree in a `Boundary.*` variant to intercept rendering-path errors and show a fallback. Six variants are available — `catchAll`, `catchAllCause`, `catchTag`, `catchTags`, `catchSome`, and `catchIf`:

```typescript
import { Boundary, h } from "@weftui/core";
import { Data, Effect } from "effect";

class ApiError extends Data.TaggedError("ApiError")<{ status: number }> {}

const SafeWidget = () =>
  Boundary.catchAll({ fallback: (e) => h.div({ class: "error" }, `Request failed: ${e.status}`) }, [
    Effect.fail(new ApiError({ status: 503 })),
  ]);
```

Errors that fail their `match` condition (e.g. wrong tag in `catchTag`) re-raise to the nearest parent boundary. If there is no parent, the mount fails.

See [examples/error-boundary](../../examples/error-boundary) for a runnable demo of all six failure-catch variants.

## Server-side rendering

Render on the server and hydrate on the client with `@weftui/dom/server` + `hydrate`. `Boundary.rpc` resolves an rpc on the server, serializes its result into the HTML, replays it on the client without a second request, then keeps the region live for refetch:

```typescript
import { Boundary, h } from "@weftui/core";
import { Stream } from "effect";
import { GetStock } from "./data/inventory";

const StockPanel = (id: number) =>
  Boundary.rpc(
    GetStock,
    () => ({ id }),
    (resource) => h.span([Stream.map(resource.value.changes, (s) => String(s.units))]),
  );
```

See the [rpc data boundaries guide](./rpc-data-boundaries.md) for the full model — the contract/handler split, router wiring, the four lifecycles, and typed-failure replay.

## Next steps

- [Combinator API](../concepts/combinator-api.md) — deep dive into `h`, `h.fragment`, and `Component.gen` / `Component.make`
- [Reactive Primitives](../concepts/reactive-primitives.md) — the full `Source` vocabulary and how streams flow through the tree
- [Component Authoring](./component-authoring.md) — writing reusable components with `Component.gen` / `Component.make`
- [Server-Side Rendering](./server-side-rendering.md) — SSR, hydration, and rpc-backed data with `Boundary.rpc`
- [Routing](./routing.md) — universal nested routing with `@weftui/router`
- [`@weftui/core` API Reference](../api/core.md) and [`@weftui/router` API Reference](../api/router.md)
- [examples/](../../examples/) — runnable examples covering common patterns
