# Ambient service context does not reach route render — spec / bug note

## Status

**Open bug / known limitation.** Filed from the Weft website build (the docs site
needs an app-wide `Docs` service available to every route component). Documents
observed behavior, the expected behavior, and the current workaround so it can be
fixed without re-discovering the constraint.

## Summary

Services provided **ambiently** around a `RouterServer` render — i.e.
`Effect.provide(RouterServer.render(def, opts), MyServiceLive)` — are **not** visible
to the route/layout/document-shell components when they execute. A component that does
`yield* MyService` dies with a missing-service defect (surfaced as an HTTP 500),
even though the layer was provided to the enclosing effect.

The only services a component can rely on during render are the ones `RouterServer`
threads in explicitly: `Router`, `Router.Outlet`, and the `AppRpcClientTag` from the
`rpc` option. There is no public seam to inject an arbitrary app-wide service.

## Reproduction

```ts
class Greeting extends Context.Tag("Greeting")<Greeting, { text: string }>() {}

const Page = Component.gen(function* () {
  const g = yield* Greeting; // <-- dies: Greeting not in context
  return yield* h.h1(g.text);
});

const def = Router.router(
  Router.layout({ component: Page }, [Router.route("", { component: Page })]),
  {
    notFound: () => h.h1("404"),
  },
);

// Greeting provided ambiently around render:
const { status } = await Effect.runPromise(
  Effect.provide(
    RouterServer.render(def, { document, url: "/" }),
    Layer.succeed(Greeting, { text: "hi" }),
  ),
);
// Expected: 200 with "hi". Actual: 500 — Greeting missing during the leaf render.
```

## Likely cause

Two layers compound:

1. **Dispatch boundary.** `RouterServer` dispatches each request through platform's
   `HttpApiBuilder` (`webHandlerWith` builds a server-local `HttpApi` and
   `builder.group(...).handle(...)` runs the leaf), executed in the builder's **own**
   managed context — it does not inherit the ambient context of the effect that called
   `render`. `renderDocument` then provides only `Router`, `Router.Outlet`, and
   `appRpcClientLayer(rpc)` before `renderToStringHydratable`.
2. **Reactive-outlet draining.** The matched route tree is rendered through the
   reactive **outlet stream** (`outlet.ts` `levelStream` → `renderLevel` →
   `match.leaf.component(...)`). The DOM renderer drains that `Stream` child in the
   **top** `renderToStringHydratable` context, **not** in the context provided to any
   intermediate node. So even `Effect.provideService(outletNode, MyService, …)` inside
   the document shell does **not** reach the leaf — the provided service is lost when
   the renderer drains the inner stream.

Together: the only context the leaf sees is whatever `renderDocument` puts on the
top render, and the app node is cast to `Node<never, never>` so the requirement is
never tracked.

## Expected behavior

One of:

1. **A render-time `provide`/`context` option.** `RouterServer.render` /
   `toWebHandler` / `toStreamingWebHandler` accept an additional
   `Layer<R>` (or `Context<R>`) that is provided to the document + app render, so
   app-wide services compose like the existing `rpc` option does. The def's aggregate
   `R` (already tracked in its phantom type) would then be dischargeable at the entry
   instead of being silently cast away.
2. **Ambient inheritance.** The platform dispatch inherits the caller's context so
   `Effect.provide(render(...), L)` works as written.

Option 1 is preferred — explicit, type-trackable, and symmetric with `rpc`.

## Workarounds tried

- ❌ **Ambient** `Effect.provide(render(...), L)` — dropped at the dispatch boundary.
- ❌ **`provideService` on the outlet node** inside the document shell — lost when the
  renderer drains the reactive outlet stream in the top context (cause #2 above).

## Current workaround (website)

Because **no** in-tree service provision reaches route leaves, the website does **not**
use an Effect service for the doc model. The data is a **module singleton** the route
components import directly:

```ts
// lib/docs-live.ts — imports the build-time virtual module
export const liveDocs: DocsService = makeDocs(getAllDocs());

// a route component
const doc = liveDocs.get(category, slug); // plain import, no context needed
```

A plain import sidesteps context entirely, so it works through the router on both
server and client. Test seam without module mocking: the loader's Vite plugin
(`virtual:weft-docs`) is registered in the **root** vite config too, so `vp test`
resolves the real baked model and the integration test renders the real app against
real docs (`website/src/routes/routes.test.ts`); pure units (`makeDocs`/`buildNav`/
render helpers) take fixtures as plain arguments.

When this bug is fixed (a render-time `provide` seam), the module singleton can become
a `Docs` service with `DocsLive` / fixture layers, and tests provide the layer instead
of relying on the root-registered plugin.

## Acceptance criteria (for the fix)

- AC1: A service provided through the new render-time seam is readable via
  `yield* Service` from any route, layout, and the document shell, on both
  `render` and the web handlers.
- AC2: The def's aggregate requirement `R` is reflected in the render/handler API
  types (not cast to `never`), so a missing provide is a compile error.
- AC3: Existing `rpc`-only apps and no-service apps keep working unchanged.
- AC4: Client parity — the same service seam (or its documented client equivalent)
  reaches the hydrated tree.
