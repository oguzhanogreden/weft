---
title: Errors and Server Rendering
order: 4
section: tutorial
description: Catch rendering-path failures with Boundary, then render on the server and hydrate. The last step of the tutorial.
---

# Errors and Server Rendering

The final step. [We can now](./03-services-and-async.md) use services and async. Here we make the fact panel's fetch fail on purpose, catch it with a boundary, and render the whole counter on the server.

## Error boundaries

A component's failures accumulate on its `E` channel. Wrap a subtree in a `Boundary.*` variant to intercept them and render a fallback instead of failing the mount. In `src/app.ts`, make `fetchFact` fail for `n === 3`, the value the counter's fact panel actually requests:

```typescript
import { Boundary, h } from "@weftui/core";
import { Data, Effect } from "effect";

class FactError extends Data.TaggedError("FactError")<{ n: number }> {}

const fetchFact = (n: number): Effect.Effect<string, FactError> =>
  Effect.gen(function* () {
    yield* Effect.sleep("800 millis");
    if (n === 3) return yield* Effect.fail(new FactError({ n }));
    return `${n} is ${n % 2 === 0 ? "even" : "odd"}.`;
  });
```

Wrap the fact panel where it's placed in `App`:

```typescript
Boundary.catch(
  { fallback: (e) => h.p({ class: "error" }, `Couldn't load a fact about ${e.n}.`) },
  [NumberFact({ n: 3 })],
),
```

There are six failure-catch variants, mirroring Effect's own error operators: `catch`, `catchCause`, `catchTag`, `catchTags`, `catchFilter`, `catchIf`. `Boundary.catch` here fully consumes `FactError` from the subtree's `E`; the app's aggregate `E` stays `never`. A failure a boundary doesn't match re-raises to the **nearest enclosing** boundary; if none catches it, the mount fails. The conceptual model (and why the boundary's type reflects exactly which failures are handled) is [Boundaries and Suspense](../explanation/boundaries-and-suspense.md).

Reload and the fact panel shows "Couldn't load a fact about 3." instead of hanging or crashing the mount.

## Render on the server

The same component tree renders to HTML on the server and **hydrates in place** on the client: no re-render, no flash. `hydrate` adopts the server's existing DOM and resumes reactivity. Split `main.ts` into two entries that both import the same side-effect-free `App`:

```typescript
// src/entry-server.ts
import { AppRpcClientTag } from "@weftui/core";
import { renderToStringHydratable } from "@weftui/dom/server";
import { Effect, Layer } from "effect";
import { App } from "./app";

// This tree has no `Boundary.rpc`, but the SSR renderer always requires an
// AppRpcClientTag in context, so discharge it with a no-op.
const NoRpc = Layer.succeed(AppRpcClientTag, {
  call: () => Effect.die(new Error("no rpc in this app")),
});

export const render = (): Promise<string> =>
  Effect.runPromise(Effect.provide(renderToStringHydratable(App()), NoRpc));
```

```typescript
// src/entry-client.ts
import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App, LoggerLive } from "./app";

const root = document.getElementById("root")!;

const app = WeftApp.make(LoggerLive);
void Effect.runPromise(WeftApp.hydrate(app, App(), root));
```

Splice `render()`'s HTML into your server template's `#root`, and point `index.html`'s script tag at `entry-client.ts` instead of `main.ts`. `AppRpcClientTag` and the `NoRpc` no-op only matter here because `renderToStringHydratable` requires that seam unconditionally; a tree using [`Boundary.rpc`](../how-to/load-data-with-rpc.md) would provide a real one instead, typically via `@weftui/router`'s `RouterServer`.

For server-resolved data that replays into the client without a second request, `Boundary.rpc` extends this model: resolve an rpc on the server, serialize its result into the HTML, replay it on hydrate, and keep the region live for refetch.

## You're done

You've built up every core idea: components and `h`, reactive state and streams, services and async, boundaries and SSR, all in one counter. Where to go next depends on what you're doing:

- **Understand the model** → [The Rendering Model](../explanation/rendering-model.md), [The Combinator API](../explanation/combinator-api.md), [Reactive Primitives](../explanation/reactive-primitives.md)
- **Get a task done** → [Author Components](../how-to/author-components.md), [Render on the Server](../how-to/render-on-the-server.md), [Load Data with RPC](../how-to/load-data-with-rpc.md), [Add Routing](../how-to/add-routing.md)
- **Look up an API** → [`@weftui/core`](../reference/core.md), [`@weftui/dom`](../reference/dom.md), [`@weftui/router`](../reference/router.md)
- **Read runnable code** → [examples/](../../examples/)
