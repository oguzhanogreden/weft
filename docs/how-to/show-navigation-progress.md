---
title: Show Navigation Progress
order: 7
section: how-to
description: Render a pending indicator (e.g. a top progress bar) during a deferred-commit navigation by reading the router's Router.navigating signal.
---

# Show Navigation Progress

**Goal:** show a progress indicator while a [lazy route](./split-routes-lazily.md) resolves its chunk, so a slow network is visible instead of feeling frozen.

When you navigate to a route whose component (or a layout in its branch) is `Router.lazy`, the router is **deferred-commit**: it resolves the chunk _before_ swapping the URL, keeping the previous page mounted meanwhile. That resolve window is exposed as a reactive signal, [`Router.navigating`](../reference/router.md#routernavigating), that you read to render pending UI.

```typescript
import { Component, h } from "@weftui/core";
import { Router } from "@weftui/router";
import { Stream } from "effect";

const Shell = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  const nav = yield* Router.navigatingStream;
  return yield* h.div({ id: "app" }, [
    h.div({
      id: "nav-progress",
      "aria-hidden": "true",
      class: Stream.map(nav.changes, (s) =>
        s._tag === "Navigating" ? "nav-progress is-navigating" : "nav-progress",
      ),
    }),
    h.main([outlet]),
  ]);
});
```

Thread the signal into a persistent layout (the outermost `Shell` is ideal, since it never re-renders across navigations), and style the pending class however you like — a top bar, a cursor change, a dimmed outlet.

## The signal

`NavState` is a two-state machine:

```typescript
type NavState = { readonly _tag: "Idle" } | { readonly _tag: "Navigating"; readonly to: string };
```

Read it two ways, mirroring `Router.params` / `Router.paramsStream`:

- `Router.navigating` — the `Subscribable<NavState>` on the `Router` service.
- `Router.navigatingStream` — an `Effect` resolving that `Subscribable`, for use in a `Component.gen` body (as above).

The `to` field on `Navigating` is the target URL, if you want to label _where_ the app is going.

## Behavior to expect

- **Only lazy navigations flip it.** A navigation whose matched branch has no `Router.lazy` node commits synchronously and `navigating` stays `Idle` — an entirely eager app never sees `Navigating`, and adding the reader costs nothing.
- **Latest-wins.** Rapid successive navigations commit only the newest; a superseded navigation never resets the signal (the newer one owns it).
- **Back/forward.** `popstate` into a lazy route also resolves before committing, so the indicator shows for browser back/forward too.
- **Failure resets it.** A rejected chunk load is a defect that resets `navigating` to `Idle` (it never sticks on), then surfaces through normal defect handling.
- **Server renders `Idle`.** Server render is buffered, so `navigating` is a client-only concern; the server supplies a constant `Idle` so the same `Shell` type-checks and renders on both sides.

## See also

- [`Router.navigating` API reference](../reference/router.md#routernavigating)
- [Split Routes Lazily](./split-routes-lazily.md) — the `Router.lazy` deferred-commit navigation this reports on
- [examples/router-ssr](../../examples/router-ssr) — wires this exact progress bar in its `Shell` (`components/shell.ts`), with a `pending-navigation.browser.test.ts`
