# Weft

[![CI + Release](https://github.com/stefvw93/weft/actions/workflows/ci-release.yml/badge.svg)](https://github.com/stefvw93/weft/actions/workflows/ci-release.yml)

> Reactive UI, woven from [Effect](https://effect.website).

Frontend at scale is hard. Real applications need robust API orchestration, error handling, retries, and telemetry. [Effect](https://effect.website) solves these problems elegantly; Weft brings the same patterns to the UI layer — in the browser and on the server.

Weft is a reactive DOM library where every node _is_ an Effect. Components are plain functions that return `Node<E, R>` — a type alias for `Effect.Effect<DOMNode, E, R>` — so your component tree is the **warp**, the fixed structure held under tension, and streams are the **weft**, the live thread drawn across it. Error and requirement channels accumulate naturally through the tree, and all Effect combinators work on nodes directly. Streams drive all updates; there is no virtual DOM or diffing. On the server, the same component tree renders to an HTML string or a streaming response, and `hydrate()` resumes reactivity in place on the client without re-rendering.

> **Early Development Notice**: Weft is in active early development. APIs may change rapidly. Not recommended for production use yet.

## Features

- **Effect-first architecture**: Services, Layers, and dependency injection across client and server
- **Combinator API**: Build trees with `h`, `h.fragment`, and `Component.gen` / `Component.make` — no JSX, no build-tool plugins
- **Type-safe channels**: Effect's `E` and `R` channels propagate through the full component tree
- **Ephemeral components**: Components run once, streams drive all updates
- **SSR + Hydration**: `renderToString`, `renderToStream`, and flash-free `hydrate()` for full-stack apps
- **Progressive streaming**: `renderToStream` emits HTML chunks in document order as slow nodes resolve
- **Universal routing**: `@weftui/router` maps a URL to a nested page tree on both server and client, with type-safe params and persistent layouts

## Packages

Weft is a monorepo with three packages:

- **`@weftui/core`**: Combinator builders and type definitions. Exports `h`, `h.fragment`, `Component` (with `Component.gen` / `Component.make`), `Suspense`, `Boundary` (six error-boundary variants), and the `Node<E, R>` / `Source<A, E, R>` types.
- **`@weftui/dom`**: The renderer. `mount` and `hydrate` for the browser; `renderToString`, `renderToStringHydratable`, `renderToStream`, and `renderToStreamHydratable` for the server (imported from `@weftui/dom/server`).
- **`@weftui/router`**: Universal nested router. Authors a route tree with `Router.route` / `Router.layout` / `Router.router`, renders it on the server (`@weftui/router/server`) and the client (`@weftui/router/client`), with type-safe `href`s and dependency-injected params.

## Installation

```bash
npm install @weftui/core @weftui/dom @weftui/router effect
```

**New to Effect?** Check out the [Effect documentation](https://effect.website/docs/getting-started/introduction) to learn the fundamentals.

## A minimal app

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

## Documentation

Full documentation lives in [`docs/`](./docs/index.md):

- [Getting Started](./docs/guides/getting-started.md) — install, first component, reactive state, services, error boundaries, SSR teaser
- [The Combinator API](./docs/concepts/combinator-api.md) — `h`, `Component.gen` / `Component.make`, `Node` as an `Effect`
- [Reactive Primitives](./docs/concepts/reactive-primitives.md) — `Source`, streams, derived streams, reactive styles
- [Component Authoring](./docs/guides/component-authoring.md) — plain functions, instance scope, `forkScoped`, fragments
- [Server-Side Rendering](./docs/guides/server-side-rendering.md) — `renderToStringHydratable`, `hydrate`, `Boundary.rpc`
- [RPC Data Boundaries](./docs/guides/rpc-data-boundaries.md) — server-resolved, client-refreshable data
- [Routing](./docs/guides/routing.md) — `@weftui/router`, universal nested routing
- [API Reference](./docs/api/core.md)

## Examples

The [examples/](./examples) directory contains standalone applications you can run with `vp run -F <name> dev`:

| Example                      | What it shows                                                              |
| ---------------------------- | -------------------------------------------------------------------------- |
| `async-data-loading`         | Loading states, retry, and error boundaries with Stream and Effect         |
| `declarative-event-handlers` | Plain, Effect-returning, service-aware, and reactive event handlers        |
| `element-ref`                | DOM refs with `SubscriptionRef<Option<HTMLElement>>` for post-mount access |
| `error-boundary`             | All six `Boundary.*` variants: catchAll, catchTag, catchTags, and more     |
| `form-handling`              | Reactive inputs, Schema-based validation, and Effect submit handlers       |
| `keyed-list`                 | Keyed list rendering                                                       |
| `list-rendering`             | Static and stream-based lists, Fragments, and nested iterables             |
| `reactive-styles`            | Per-property and whole-object stream styles, CSS transitions               |
| `router-ssr`                 | Universal nested routing with `@weftui/router`: SSR, hydration, layouts    |
| `ssr-hydration`              | Server rendering with `renderToStringHydratable` and client `hydrate`      |
| `subscription-ref`           | Local state, derived streams, and coordinating multiple refs               |
| `suspense`                   | Suspense boundaries for streaming SSR and client-side coordination         |

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
