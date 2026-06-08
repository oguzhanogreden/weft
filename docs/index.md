# effect-ui Documentation

effect-ui is an Effect-native reactive DOM library. `Node<E, R>` is `Effect.Effect<DOMNode, E, R>` — every element in the tree is an Effect, so error and requirement channels accumulate through the tree, all Effect combinators apply directly to nodes, and services flow from mount through handlers. Streams drive all updates; there is no virtual DOM. The same component tree renders to an HTML string or streaming response on the server, and `hydrate()` resumes reactivity in place on the client without re-rendering.

---

**Evaluating?** Start with Getting Started to see the model in motion, then read the concept docs to understand why it works the way it does.

**Building?** Jump to the guides for authoring patterns and server integration, or go straight to the API reference.

---

## Learning order

1. **[Getting Started](guides/getting-started.md)** — install, first component, reactive state, services, async, error boundaries, SSR teaser.

2. **[The Combinator API](concepts/combinator-api.md)** — how `h`, `h.fragment`, and `Component.gen` / `Component.make` work; why `Node` is an `Effect`; how `E` and `R` accumulate through a tree.

3. **[Reactive Primitives](concepts/reactive-primitives.md)** — the `Source<A, E, R>` vocabulary; `Stream`, `Effect`, and `Subscribable` as prop values and children; derived streams, reactive styles, and `NoPropValue`.

4. **[Component Authoring](guides/component-authoring.md)** — plain functions vs. `Component.gen` / `Component.make`; instance scope and `Effect.forkScoped`; fragments, render-prop children, and service requirements.

5. **[Server-Side Rendering](guides/server-side-rendering.md)** — `renderToString` / `renderToStringHydratable` / streaming variants; `hydrate`; the server/client split.

6. **[RPC Data Boundaries](guides/rpc-data-boundaries.md)** — `Boundary.rpc`: server-resolved, client-refreshable data; the contract/handler split; the `Resource` handle and its four lifecycles.

7. **[Routing](guides/routing.md)** — `@effect-ui/router`: universal nested routing, `Router.route` / `Router.layout` / `Router.router`, type-safe `href`, layouts, programmatic navigation.

8. **[`@effect-ui/core` API Reference](api/core.md)** and **[`@effect-ui/router` API Reference](api/router.md)** — full API surface for both packages.

---

## Examples

The [`examples/`](../examples/) directory contains standalone runnable apps. Each covers a specific pattern and ships with a browser test:

| Example | What it shows |
| --- | --- |
| `async-data-loading` | Loading states, retry, error boundaries with Stream and Effect |
| `declarative-event-handlers` | Plain, Effect-returning, service-aware, and reactive handlers |
| `element-ref` | DOM refs with `SubscriptionRef<Option<HTMLElement>>` |
| `error-boundary` | All six `Boundary.*` variants |
| `form-handling` | Reactive inputs, Schema validation, Effect submit handlers |
| `keyed-list` | Keyed list rendering |
| `list-rendering` | Static and stream-based lists, fragments, nested iterables |
| `reactive-styles` | Per-property and whole-object stream styles, CSS transitions |
| `router-ssr` | Universal nested routing with SSR, hydration, layouts, `Boundary.rpc` |
| `ssr-hydration` | SSR + hydration without server data loading |
| `subscription-ref` | Local state, derived streams, coordinating multiple refs |
| `suspense` | Suspense boundaries for streaming SSR and client coordination |
