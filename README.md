# Effect UI

[![CI + Release](https://github.com/stefvw93/effect-ui/actions/workflows/ci-release.yml/badge.svg)](https://github.com/stefvw93/effect-ui/actions/workflows/ci-release.yml)

> Production-grade frontend development with [Effect](https://effect.website)

## Why effect-ui?

Frontend at scale is hard. Real applications need robust API orchestration, error handling, retries, telemetry, and server rendering. [Effect](https://effect.website) solves these problems elegantly; effect-ui brings the same patterns to the browser and the server.

effect-ui is a reactive DOM rendering library built on Effect's combinator API. Components are plain functions that return `Node<E, R>` — a type alias for `Effect.Effect<DOMNode, E, R>` — which means every element in the tree is an Effect. Error and requirement channels accumulate naturally through the tree, and all Effect combinators work on nodes directly. Streams drive all updates; there is no virtual DOM or diffing. On the server, the same component tree renders to an HTML string or a streaming response, and `hydrate()` resumes reactivity in place on the client without re-rendering.

> **Early Development Notice**: effect-ui is in active early development. APIs may change rapidly. Not recommended for production use yet.

## Features

- **Effect-first architecture**: Services, Layers, and dependency injection across client and server
- **Combinator API**: Build trees with `h`, `h.fragment`, and `Component.gen` / `Component.make` — no JSX, no build-tool plugins
- **Type-safe channels**: Effect's `E` and `R` channels propagate through the full component tree
- **Ephemeral components**: Components run once, streams drive all updates
- **SSR + Hydration**: `renderToString`, `renderToStream`, and flash-free `hydrate()` for full-stack apps
- **Progressive streaming**: `renderToStream` emits HTML chunks in document order as slow nodes resolve

## Packages

effect-ui is a monorepo with two packages:

- **`@effect-ui/core`**: Combinator builders and type definitions. Exports `h`, `h.fragment`, `Component` (with `Component.gen` / `Component.make`), `Suspense`, `Boundary` (six error-boundary variants), and the `Node<E, R>` / `Source<A, E, R>` types.
- **`@effect-ui/dom`**: The renderer. `mount` and `hydrate` for the browser; `renderToString`, `renderToStringHydratable`, `renderToStream`, and `renderToStreamHydratable` for the server (imported from `@effect-ui/dom/server`).

## Installation

Install from [GitHub releases](https://github.com/stefvw93/effect-ui/releases) (not yet published to package registries).

**New to Effect?** Check out the [Effect documentation](https://effect.website/docs/getting-started/introduction) to learn the fundamentals.

## Examples

### API Call with Error Handling

Effect's error handling patterns work directly in your UI:

```typescript
import { h } from "@effect-ui/core";
import { mount } from "@effect-ui/dom/client";
import { Effect, Stream } from "effect";

const fetchUser = (id: number) =>
  Effect.tryPromise({
    try: () => fetch(`/api/users/${id}`).then((r) => r.json()),
    catch: () => new Error("Failed to fetch user"),
  });

const UserProfile = ({ id }: { id: number }) =>
  Stream.concat(
    Stream.make(h.div({}, "Loading...")),
    Stream.fromEffect(
      fetchUser(id).pipe(
        Effect.flatMap((user) => h.div({}, user.name)),
        Effect.catchAll(() => h.div({}, "Failed to load user")),
      ),
    ),
  );

void Effect.runPromise(mount(UserProfile({ id: 1 }), document.getElementById("root")!));
```

### Event Handler with Service Access

Event handlers can return Effects, giving them full access to services via dependency injection:

```typescript
import { h } from "@effect-ui/core";
import { mount } from "@effect-ui/dom/client";
import { Context, Effect, Layer } from "effect";

class Analytics extends Context.Tag("Analytics")<
  Analytics,
  { track: (event: string) => Effect.Effect<void> }
>() {}

const AnalyticsLive = Layer.succeed(Analytics, {
  track: (event) => Effect.sync(() => console.log(`[Analytics] ${event}`)),
});

const SaveButton = () =>
  h.button(
    {
      onclick: () =>
        Effect.gen(function* () {
          const analytics = yield* Analytics;
          yield* analytics.track("save_clicked");
        }),
    },
    "Save",
  );

void Effect.runPromise(
  mount(SaveButton(), document.getElementById("root")!).pipe(Effect.provide(AnalyticsLive)),
);
```

### Reactive State with SubscriptionRef

SubscriptionRef provides reactive state with automatic stream-based updates:

```typescript
import { h } from "@effect-ui/core";
import { mount } from "@effect-ui/dom/client";
import { Effect, SubscriptionRef } from "effect";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    return yield* h.div({}, [
      h.span({}, [count.changes]),
      h.button({ onclick: () => SubscriptionRef.update(count, (n) => n + 1) }, "+"),
      h.button({ onclick: () => SubscriptionRef.update(count, (n) => n - 1) }, "-"),
    ]);
  });
```

### Derived Streams

Transform reactive values with standard Stream operations:

```typescript
import { h } from "@effect-ui/core";
import { Effect, Stream, SubscriptionRef } from "effect";

const Dashboard = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    const doubled = Stream.map(count.changes, (n) => n * 2);
    const status = Stream.map(count.changes, (n) => (n > 10 ? "High" : "Normal"));

    return yield* h.div({}, [
      h.p({}, ["Count: ", count.changes]),
      h.p({}, ["Doubled: ", doubled]),
      h.p({}, ["Status: ", status]),
      h.button({ onclick: () => SubscriptionRef.update(count, (n) => n + 1) }, "Increment"),
    ]);
  });
```

### SSR + Hydration

Render to HTML on the server, then resume reactivity on the client without re-rendering:

```typescript
// entry-server.ts
import { renderToStringHydratable } from "@effect-ui/dom/server";
import { Effect } from "effect";
import { App } from "./app";

export const render = (): Promise<string> =>
  Effect.runPromise(renderToStringHydratable(App({ initialValue: 0 })));
```

```typescript
// entry-client.ts
import { hydrate } from "@effect-ui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

void Effect.runPromise(hydrate(App({ initialValue: 0 }), document.getElementById("root")!));
```

`renderToStringHydratable` wraps each reactive region in `<!-- stream-start-N -->` / `<!-- stream-end-N -->` comment markers. `hydrate` uses those markers to locate reactive regions and adopt the existing DOM nodes in place, so the first emission never causes a flash.

## Core Concepts

**Nodes are Effects**: `Node<E, R>` is `Effect.Effect<DOMNode, E, R>`. Use `yield*`, `pipe`, and any Effect combinator directly on tree nodes:

```typescript
// yield* in Effect.gen
const node = yield * h.div({}, "Hello");

// pipe / Effect.provide
const provided = Effect.provide(h.div({}, userStream), UserServiceLive);
```

**Stream children**: pass any `Stream` as a child; each emission replaces the previous:

```typescript
const message = Stream.make("Loading...", "Ready!");
h.div({}, [message]);
```

**Stream props**: any prop accepts a stream for reactive updates:

```typescript
const isDisabled = Stream.make(true, false);
h.button({ disabled: isDisabled }, "Submit");
```

**Stream styles**: styles support streams at any level:

```typescript
h.div({ style: { color: colorStream, width: "100px" } });
h.div({ style: Stream.make({ color: "red" }, { color: "blue" }) });
```

**Reactive components**: return an `Effect` from a component to set up local state before rendering:

```typescript
const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    return yield* h.span({}, [count.changes]);
  });
```

**Defined components**: `Component.gen` and `Component.make` wrap the same patterns and propagate caller-prop `E`/`R` automatically. Both accept an optional `children` argument as either an array or a function (render-prop style):

```typescript
import { Component, h } from "@effect-ui/core";
import type { Child } from "@effect-ui/core";

// Generator body — use yield*
const TextField = Component.gen(function* (props: {
  name: string;
  value?: Stream.Stream<string, any, any>;
}) {
  return yield* h.input({ name: props.name, value: props.value });
});

// Plain function body
const Avatar = Component.make((props: { src: string }) => h.img({ src: props.src, alt: "" }));

// Function-children (render-prop pattern)
const List = Component.make(
  (props: { items: readonly string[] }, renderItem: (item: string) => readonly Child[]) =>
    h.ul({}, props.items.flatMap(renderItem)),
);

List({ items: ["a", "b"] }, (item) => [h.li({}, item)]);
```

## SSR & Hydration

`@effect-ui/dom/server` exports four rendering functions:

- `renderToString(node)`: Serializes the tree to an HTML string. Reactive values collapse to their first emission.
- `renderToStringHydratable(node)`: Same as `renderToString`, plus `<!-- stream-start-N -->` / `<!-- stream-end-N -->` comment markers around each reactive region. Use this when you need `hydrate()` on the client.
- `renderToStream(node)`: Returns a `Stream<string>` that emits HTML chunks in document order. Useful for streaming responses where slow subtrees shouldn't block the rest of the page.
- `renderToStreamHydratable(node)`: Streaming variant with hydration markers.

On the client, `hydrate(app, root)` from `@effect-ui/dom` walks the component tree against the existing server-rendered DOM, attaches event handlers, and subscribes to reactive streams. It adopts the first emission in place rather than clearing and rebuilding, so there's no visible flash.

See [examples/ssr-hydration](./examples/ssr-hydration) for a working Node.js + Vite setup.

## Examples

The [examples/](./examples) directory contains standalone applications you can run with `vp run -F <name> dev`:

| Example                      | What it shows                                                              |
| ---------------------------- | -------------------------------------------------------------------------- |
| `async-data-loading`         | Loading states, retry, and error boundaries with Stream and Effect         |
| `declarative-event-handlers` | Plain, Effect-returning, service-aware, and reactive event handlers        |
| `element-ref`                | DOM refs with `SubscriptionRef<Option<HTMLElement>>` for post-mount access |
| `form-handling`              | Reactive inputs, Schema-based validation, and Effect submit handlers       |
| `list-rendering`             | Static and stream-based lists, Fragments, and nested iterables             |
| `reactive-styles`            | Per-property and whole-object stream styles, CSS transitions               |
| `subscription-ref`           | Local state, derived streams, and coordinating multiple refs               |
| `ssr-hydration`              | Server rendering with `renderToStringHydratable` and client `hydrate`      |
| `suspense`                   | Suspense boundaries for streaming SSR and client-side coordination         |
| `error-boundary`             | All six `Boundary.*` variants: catchAll, catchTag, catchTags, and more     |

## Development

The root `vite.config.ts` defines tasks you run with `vp run <task>`:

```bash
vp install           # Install all workspace dependencies
vp run dev           # Start all examples in dev mode (runs vp run -r dev)
vp run pack          # Build all packages
vp run check         # Format, lint, and typecheck (requires pack)
vp run test          # Run all tests (requires pack)
```

To work on a single example:

```bash
vp run -F ssr-hydration dev
```

## License

MIT
