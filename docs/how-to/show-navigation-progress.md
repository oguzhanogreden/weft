---
title: Show Navigation Progress
order: 7
section: how-to
description: Render a pending indicator (e.g. a top progress bar) during a deferred-commit navigation by reading the router's Router.navigating signal.
---

# Show Navigation Progress

**Goal:** show a progress indicator while a navigation resolves a [lazy route](./split-routes-lazily.md)'s chunk or a leaf's own async data, so a slow network is visible instead of feeling frozen.

Client navigation is **deferred-commit**: the router resolves the target branch's chunk (if `Router.lazy`) and the matched leaf's own component effect before swapping the URL, so the previous page stays mounted for the whole window. Read [`Router.navigatingStream`](../reference/router.md#routernavigating) in a persistent layout to render pending UI for that window:

```typescript
import { Component, h, Subscribable } from "@weftui/core";
import { Router } from "@weftui/router";
import { Stream } from "effect";

const Shell = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  const nav = yield* Router.navigatingStream;
  return yield* h.div({ id: "app" }, [
    h.div({
      id: "nav-progress",
      "aria-hidden": "true",
      class: Stream.map(Subscribable.changes(nav), (s) =>
        s._tag === "Navigating" ? "nav-progress is-navigating" : "nav-progress",
      ),
    }),
    h.main([outlet]),
  ]);
});
```

Put this in the outermost `Shell`, since it never re-renders across navigations, and style `.is-navigating` however you like: a top bar, a cursor change, a dimmed outlet.

## The `NavState` signal

```typescript
type NavState = { readonly _tag: "Idle" } | { readonly _tag: "Navigating"; readonly to: string };
```

Read it two ways, mirroring `Router.params` / `Router.paramsStream`:

- `Router.navigatingStream`: an `Effect` resolving the `Subscribable<NavState>`, for a `Component.gen` body (as above).
- `Router.navigating`: the raw `Subscribable<NavState>` on the `Router` service, for reading outside a component.

`Navigating`'s `to` field is the target URL, if you want to label _where_ the app is going.

## Full example

A client-only app with an instant `Home` route and a `Reports` route whose component awaits its own data. That `yield*` blocks the commit, so the Shell's progress bar shows for the resolve window. This is the whole file set, copy/paste runnable in a `vite` + `@weftui/router` project.

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weft navigation progress demo</title>
    <style>
      #nav-progress {
        position: fixed;
        top: 0;
        left: 0;
        height: 3px;
        width: 0;
        background: #06c;
        opacity: 0;
      }
      #nav-progress.is-navigating {
        width: 100%;
        opacity: 1;
        transition:
          width 600ms ease-out,
          opacity 150ms;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```typescript
// src/app.ts
/**
 * Client-only demo: a Shell layout with an instant Home route and a Reports
 * route whose component awaits its own data before rendering. That `yield*`
 * makes the navigation deferred-commit, so the Shell's `Router.navigatingStream`
 * reader flips to "Navigating" for the resolve window. Side-effect-free (no
 * mount call), so `main.ts` and any test can import `App` directly.
 */
import { Component, h, Subscribable } from "@weftui/core";
import { href, Router } from "@weftui/router";
import { Effect, Stream } from "effect";

const homeRoute = Router.route("", {
  component: Component.make(() => h.section({ id: "page" }, [h.h2("Home")])),
});

const reportsRoute = Router.route("reports", {
  component: Component.gen(function* () {
    // Simulates fetching a report: this `yield*` blocks the commit, so
    // `Router.navigatingStream` reports `Navigating` for its whole duration.
    yield* Effect.sleep("600 millis");
    return yield* h.section({ id: "page" }, [h.h2("Quarterly report")]);
  }),
});

const Shell = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  const nav = yield* Router.navigatingStream;
  return yield* h.div({ id: "app" }, [
    h.div({
      id: "nav-progress",
      "aria-hidden": "true",
      class: Stream.map(Subscribable.changes(nav), (s) =>
        s._tag === "Navigating" ? "nav-progress is-navigating" : "nav-progress",
      ),
    }),
    h.nav([
      h.a({ href: href(homeRoute) }, "Home"),
      " · ",
      h.a({ href: href(reportsRoute) }, "Reports"),
    ]),
    h.main([outlet]),
  ]);
});

export const App = Router.router(Router.layout({ component: Shell }, [homeRoute, reportsRoute]), {
  notFound: () => h.section({ id: "page" }, [h.h2("404: page not found")]),
});
```

```typescript
// src/main.ts
/**
 * Browser entry: mounts the navigation progress demo into `#root`.
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

Click "Reports" and `#nav-progress` gains `is-navigating` for 600ms while `Home` stays mounted, then swaps atomically to "Quarterly report" with the bar reset to idle.

## Behavior to expect

- **Only navigations with real async work flip it.** A branch with no `Router.lazy` node and a leaf whose effect resolves synchronously (no async work, or a memoized revisit) commits in the same tick, and `navigating` stays `Idle`. An entirely eager app never sees `Navigating`, and adding the reader costs nothing.
- **Latest-wins.** Rapid successive navigations commit only the newest; a superseded navigation never resets the signal (the newer one owns it).
- **Back/forward.** `popstate` into a route with async work also resolves before committing, so the indicator shows for browser back/forward too.
- **Failure resets it.** A rejected chunk load or a failing leaf pre-run (a typed error such as `notFound()`, or a defect) resets `navigating` to `Idle` (it never sticks on), then surfaces through normal error/defect handling.
- **Server renders `Idle`.** Server render is buffered, so `navigating` is a client-only concern; the server supplies a constant `Idle` so the same `Shell` type-checks and renders on both sides.
- **No built-in anti-flash delay.** The signal flips as soon as an async window opens, so a borderline-fast navigation can flash the indicator briefly. Delay the reveal in CSS instead (e.g. `transition-delay: 200ms` on `.is-navigating`), so genuinely fast navigations never flicker.

## See also

- [`Router.navigating` API reference](../reference/router.md#routernavigating)
- [Split Routes Lazily](./split-routes-lazily.md): the `Router.lazy` deferred-commit navigation this reports on
- [examples/router-ssr](../../examples/router-ssr): wires this exact progress bar in its `Shell` (`components/shell.ts`), with a `pending-navigation.browser.test.ts`
