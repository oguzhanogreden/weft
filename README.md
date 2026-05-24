# Effect UI

[![CI + Release](https://github.com/stefvw93/effect-ui/actions/workflows/ci-release.yml/badge.svg)](https://github.com/stefvw93/effect-ui/actions/workflows/ci-release.yml)

> Production-grade frontend development with [Effect](https://effect.website)

## Why effect-ui?

Frontend at scale is hard. Real applications need robust API orchestration, error handling, retries, telemetry, and server rendering. [Effect](https://effect.website) solves these problems elegantly; effect-ui brings the same patterns to the browser and the server.

effect-ui is a reactive DOM rendering library that makes Effect and Stream first-class JSX citizens. Components run once, and streams drive all updates. No virtual DOM, no diffing: direct DOM manipulation with reactive bindings. On the server, the same JSX tree renders to an HTML string or a streaming response, and `hydrate()` resumes reactivity in place on the client without re-rendering.

> **Early Development Notice**: effect-ui is in active early development. APIs may change rapidly. Not recommended for production use yet.

## Features

- **Effect-first architecture**: Services, Layers, and dependency injection across client and server
- **Reactive primitives**: Effect and Stream as first-class JSX citizens
- **Ephemeral components**: Components run once, streams drive updates
- **SSR + Hydration**: `renderToString`, `renderToStream`, and flash-free `hydrate()` for full-stack apps
- **Progressive streaming**: `renderToStream` emits HTML chunks in document order as slow nodes resolve
- **Full TypeScript support**: Type-safe JSX with streams in props and children

## Packages

effect-ui is a monorepo with two packages:

- **`@effect-ui/core`**: JSX runtime and type definitions. Provides the `jsx`/`jsxs`/`jsxDEV` transform and the `JSXNode` type. Configure `jsxImportSource: "@effect-ui/core"` to use it.
- **`@effect-ui/dom`**: The renderer. `mount` and `hydrate` for the browser; `renderToString`, `renderToStringHydratable`, `renderToStream`, and `renderToStreamHydratable` for the server (imported from `@effect-ui/dom/server`).

## Installation

Install from [GitHub releases](https://github.com/stefvw93/effect-ui/releases) (not yet published to package registries).

Configure TypeScript for effect-ui's JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@effect-ui/core"
  }
}
```

**New to Effect?** Check out the [Effect documentation](https://effect.website/docs/getting-started/introduction) to learn the fundamentals.

## Examples

### API Call with Error Handling and Retry

Effect's retry and error handling patterns work directly in your UI:

```tsx
import { Effect, Stream, Schedule } from "effect";
import { mount } from "@effect-ui/dom";

const fetchUser = (id: number) =>
  Effect.tryPromise({
    try: () => fetch(`/api/users/${id}`).then((r) => r.json()),
    catch: () => new Error("Failed to fetch user"),
  });

const UserProfile = ({ id }: { id: number }) =>
  Stream.concat(
    Stream.make(<div>Loading...</div>),
    Stream.fromEffect(
      fetchUser(id).pipe(
        Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.compose(Schedule.recurs(3)))),
        Effect.map((user) => <div>{user.name}</div>),
        Effect.catchAll(() => Effect.succeed(<div>Failed to load user</div>)),
      ),
    ),
  );

void Effect.runPromise(mount(<UserProfile id={1} />, document.getElementById("root")!));
```

### Event Handler with Service Access

Event handlers can return Effects, which means they have access to services via dependency injection:

```tsx
import { Context, Effect, Layer } from "effect";
import { mount } from "@effect-ui/dom";

class Analytics extends Context.Tag("Analytics")<
  Analytics,
  { track: (event: string) => Effect.Effect<void> }
>() {}

const AnalyticsLive = Layer.succeed(Analytics, {
  track: (event) => Effect.sync(() => console.log(`[Analytics] ${event}`)),
});

const SaveButton = () => (
  <button
    onclick={() =>
      Effect.gen(function* () {
        const analytics = yield* Analytics;
        yield* analytics.track("save_clicked");
      })
    }
  >
    Save
  </button>
);

void Effect.runPromise(
  mount(<SaveButton />, document.getElementById("root")!).pipe(Effect.provide(AnalyticsLive)),
);
```

### Reactive State with SubscriptionRef

SubscriptionRef provides reactive state with automatic stream-based updates:

```tsx
import { Effect, SubscriptionRef } from "effect";
import { mount } from "@effect-ui/dom";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    return (
      <div>
        <span>{count.changes}</span>
        <button onclick={() => SubscriptionRef.update(count, (n) => n + 1)}>+</button>
        <button onclick={() => SubscriptionRef.update(count, (n) => n - 1)}>-</button>
      </div>
    );
  });
```

### Derived Streams

Transform reactive values with standard Stream operations:

```tsx
import { Effect, Stream, SubscriptionRef } from "effect";

const Dashboard = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    const doubled = Stream.map(count.changes, (n) => n * 2);
    const status = Stream.map(count.changes, (n) => (n > 10 ? "High" : "Normal"));

    return (
      <div>
        <p>Count: {count.changes}</p>
        <p>Doubled: {doubled}</p>
        <p>Status: {status}</p>
        <button onclick={() => SubscriptionRef.update(count, (n) => n + 1)}>Increment</button>
      </div>
    );
  });
```

### SSR + Hydration

Render to HTML on the server, then resume reactivity on the client without re-rendering:

```tsx
// entry-server.tsx
import { renderToStringHydratable } from "@effect-ui/dom/server";
import { Effect } from "effect";
import { App } from "./app";

export const render = (): Promise<string> => Effect.runPromise(renderToStringHydratable(<App />));
```

```tsx
// entry-client.tsx
import { hydrate } from "@effect-ui/dom";
import { Effect } from "effect";
import { App } from "./app";

void Effect.runPromise(hydrate(<App />, document.getElementById("root")!));
```

`renderToStringHydratable` wraps each reactive region in `<!-- stream-start-N -->` / `<!-- stream-end-N -->` comment markers. `hydrate` uses those markers to locate reactive regions and adopt the existing DOM nodes in place, so the first emission never causes a flash.

## Core Concepts

**Streams as children**: JSX elements render streams directly; each emitted value replaces the previous:

```tsx
const message = Stream.make("Loading...", "Ready!");
<div>{message}</div>;
```

**Stream properties**: Any prop can be a stream for reactive updates:

```tsx
const isDisabled = Stream.make(true, false);
<button disabled={isDisabled}>Submit</button>;
```

**Stream styles**: Styles support streams at any level:

```tsx
<div style={{ color: colorStream, width: "100px" }} />
<div style={Stream.make({ color: "red" }, { color: "blue" })} />
```

**Reactive components**: A component can return an `Effect` to set up local state before rendering:

```tsx
const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    return <span>{count.changes}</span>;
  });
```

## SSR & Hydration

`@effect-ui/dom/server` exports four rendering functions:

- `renderToString(node)`: Serializes the JSX tree to an HTML string. Reactive values collapse to their first emission.
- `renderToStringHydratable(node)`: Same as `renderToString`, plus `<!-- stream-start-N -->` / `<!-- stream-end-N -->` comment markers around each reactive region. Use this when you need `hydrate()` on the client.
- `renderToStream(node)`: Returns a `Stream<string>` that emits HTML chunks in document order. Useful for streaming responses where slow subtrees shouldn't block the rest of the page.
- `renderToStreamHydratable(node)`: Streaming variant with hydration markers.

On the client, `hydrate(app, root)` from `@effect-ui/dom` walks the JSX tree against the existing server-rendered DOM, attaches event handlers, and subscribes to reactive streams. It adopts the first emission in place rather than clearing and rebuilding, so there's no visible flash.

See [examples/ssr-hydration](./examples/ssr-hydration) for a working Node.js + Vite setup.

## Examples

The [examples/](./examples) directory contains nine standalone applications you can run with `vp run -F <name> dev`:

| Example                      | What it shows                                                              |
| ---------------------------- | -------------------------------------------------------------------------- |
| `async-data-loading`         | Loading states, retry, and error boundaries with Stream and Effect         |
| `declarative-event-handlers` | Plain, Effect-returning, service-aware, and reactive event handlers        |
| `element-ref`                | DOM refs with `SubscriptionRef<Option<HTMLElement>>` for post-mount access |
| `form-handling`              | Reactive inputs, Schema-based validation, and Effect submit handlers       |
| `list-rendering`             | Static and stream-based lists, Fragments, and nested iterables             |
| `reactive-styles`            | Per-property and whole-object stream styles, CSS transitions               |
| `subscription-ref`           | Local state, derived streams, and coordinating multiple refs               |
| `type-augmentation`          | Augmenting `JSX.Requirements` for compile-time service verification        |
| `ssr-hydration`              | Server rendering with `renderToStringHydratable` and client `hydrate`      |

## Development

The root `vite.config.ts` defines four tasks you run with `vp run <task>`:

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

ISC
