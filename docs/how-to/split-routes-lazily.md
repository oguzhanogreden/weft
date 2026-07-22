---
title: Split Routes Lazily
order: 6
section: how-to
description: Code-split a route's component into its own chunk with Router.lazy, keeping the descriptor eager so matching, href, and SSR stay unchanged.
---

# Split Routes Lazily

**Goal:** keep a heavy page's render code (and its dependencies) out of the initial bundle, loading it only when its route is actually rendered.

Wrap the route's `component` in [`Router.lazy`](../reference/router.md#routerlazy):

```typescript
import { Router } from "@weftui/router";
import { Schema } from "effect";

Router.route("docs/:category/:slug", {
  path: { category: Schema.String, slug: Schema.String },
  component: Router.lazy(() => import("./doc-page").then((m) => m.DocPage)),
});
```

The route's **descriptor** (segment, `path`/`query` schemas) stays eager, so the matcher, `href`, and the server's dispatch API still see it statically. Only the component body is split into its own chunk, fetched on the server during render and on the client on navigation. Only the **matched branch's** chunks are ever loaded.

`E`/`R` are preserved: a lazy route has the exact same channels as the same component declared eagerly. An unmet service requirement is still a compile error at `Router.router(...)`.

## Make the split real

`Router.lazy` only splits if the dynamic `import()` is the **only eager path** to the heavy module. Keep the `Router.route(…)` descriptor in an eagerly-imported file. Move the component implementation (and its heavy deps) into a separate module referenced _only_ through `Router.lazy(() => import("./impl"))`:

```typescript
// routes.ts: eager and tiny, just the descriptor
export const docsRoute = Router.route("docs/:category/:slug", {
  path: { category: Schema.String, slug: Schema.String },
  component: Router.lazy(() => import("./doc-page-impl").then((m) => m.DocsPage)),
});

// doc-page-impl.ts: heavy, pulled into its own chunk, never in the initial graph
export const DocsPage = Component.gen(function* () {
  /* renderHast, code highlighting, … */
});
```

A descriptor file that still `import`s the impl statically gains nothing: the bundler keeps it in the initial graph.

## What you get for free

- **Flash-free hydration.** On a directly-loaded lazy route, the client re-invokes the same slot, awaits the chunk, and adopts the server DOM in place. The first production matches, so nothing is mutated.
- **Blank-free navigation.** Client navigation is **deferred-commit**: the router resolves the target branch's chunk **and the matched leaf's own component effect** _before_ committing the URL. The previous page stays mounted through the fetch and any data the leaf awaits, and the swap is a single tick. See [Show Navigation Progress](./show-navigation-progress.md) for the `Router.navigating` signal this exposes.
- **Synchronous revisits.** `Router.lazy` memoizes its load per slot. The first render triggers the `import()`; every later render (including a revisit after navigating away) reuses the resolved module.

```typescript
// One slot, created once. Its loader Promise resolves on first render and is
// reused on every later render, including back-navigation to this route.
const page = Router.lazy(() => import("./doc-page").then((m) => m.DocPage));

Router.route("docs/intro", { component: page });
```

## Edge cases

- **Lazy layouts.** A `Router.layout({ component: Router.lazy(...) })` splits too. Each lazy node in the matched branch is awaited; nodes outside it never load.

  ```typescript
  Router.layout(
    { component: Router.lazy(() => import("./admin-shell").then((m) => m.AdminShell)) },
    [settingsRoute, usersRoute],
  );
  ```

- **Chunk-load failure is a defect.** If the `import()` rejects (offline, or a stale client requesting a chunk a new deploy removed), it dies as a defect and surfaces through normal defect handling. It never hangs or silently 404s. The rejection is memoized, so the route keeps failing until a reload (the deploy-skew case).
- **Not a lazy _subtree_.** Only the component is lazy. You cannot defer a whole `RouteNode` behind an `import()`; the matcher needs every leaf's segment and param schema before anything loads.

## Complete example

A client-only app with two routes: `Home` (eager) and `Lazy` (split into its own chunk). This is the whole file set, copy/paste runnable in a `vite` + `@weftui/router` project.

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weft lazy routing demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```typescript
// src/lazy-page.ts
/**
 * The lazily-loaded page body. Kept in its own module so the dynamic
 * `import()` in `app.ts` is a real code-split point, not just a wrapper
 * around a statically-imported value.
 */
import { Component, h } from "@weftui/core";

export const LazyPage = Component.make(() =>
  h.section({ id: "page" }, [h.h2("Lazy page"), h.p("Loaded on demand.")]),
);
```

```typescript
// src/app.ts
/**
 * Client-only lazy-routing demo: a Home route declared eagerly, and a Lazy
 * route whose component is code-split via `Router.lazy`. Side-effect-free (no
 * mount call), so `main.ts` and any test can import `App` directly.
 */
import { Component, h } from "@weftui/core";
import { href, Router } from "@weftui/router";

const homeRoute = Router.route("", {
  component: Component.make(() => h.section({ id: "page" }, [h.h2("Home")])),
});

const lazyRoute = Router.route("lazy", {
  component: Router.lazy(() => import("./lazy-page").then((m) => m.LazyPage)),
});

const Shell = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  return yield* h.div({ id: "app" }, [
    h.nav([h.a({ href: href(homeRoute) }, "Home"), " · ", h.a({ href: href(lazyRoute) }, "Lazy")]),
    h.main([outlet]),
  ]);
});

export const App = Router.router(Router.layout({ component: Shell }, [homeRoute, lazyRoute]), {
  notFound: () => h.section({ id: "page" }, [h.h2("404: page not found")]),
});
```

```typescript
// src/main.ts
/**
 * Browser entry: mounts the lazy-routing demo into `#root`. No server render
 * to hydrate, so this uses `WeftApp.mount`, not `hydrate`.
 */
import { WeftApp } from "@weftui/dom/client";
import { RouterApp, RouterLive } from "@weftui/router/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

const app = WeftApp.make(RouterLive(App));
void Effect.runPromise(WeftApp.mount(app, RouterApp(App), root));
```

Load `/`, open the network panel, then click "Lazy": `lazy-page`'s chunk fetches only on that click, not on initial load. Click "Home" then "Lazy" again and no second fetch fires: the slot's memo serves the resolved component.

## See also

- [`Router.lazy` API reference](../reference/router.md#routerlazy)
- [Show Navigation Progress](./show-navigation-progress.md): the deferred-commit `Router.navigating` signal
- [Add Routing](./add-routing.md): authoring the route tree `Router.lazy` plugs into
- [examples/router-ssr](../../examples/router-ssr): includes a `Router.lazy` page (`lazy-page.ts`) with a browser test
