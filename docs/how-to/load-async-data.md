---
title: Load Async Data
order: 9
section: how-to
description: Show a loading state then resolved content with Stream.concat, and turn a failed fetch into a fallback node with Effect.catch, all client-side.
---

# Load Async Data

**Goal:** render a loading placeholder, then the fetched content, and a fallback if the fetch fails, for data that loads **on the client**.

Return a `Stream<Node>` that emits the loading node first and the resolved node second, sequenced with `Stream.concat`. Handle failure inside the effect with `Effect.catch`, which maps the error to a fallback node.

```typescript
import { h } from "@weftui/core";
import { Effect, pipe, Stream } from "effect";

interface User {
  id: number;
  name: string;
  email: string;
}

const fetchUser = (id: number): Effect.Effect<User, Error> =>
  Effect.gen(function* () {
    yield* Effect.sleep("1000 millis");
    if (id === 3) return yield* Effect.fail(new Error("User not found"));
    return { id, name: `User ${id}`, email: `user${id}@example.com` };
  });

const UserCard = ({ id }: { id: number }) =>
  Stream.concat(
    Stream.make(h.div({ class: "loading" }, `Loading user ${id}…`)),
    Stream.fromEffect(
      pipe(
        fetchUser(id),
        Effect.flatMap((user) => h.div({ class: "user-card" }, [h.h3(user.name), h.p(user.email)])),
        Effect.catch((error) => h.div({ class: "error" }, `Error: ${error.message}`)),
      ),
    ),
  );
```

## How it works

- **`Stream.concat`** sequences two streams: `Stream.make(loadingNode)` emits once immediately, then `Stream.fromEffect(effect)` emits the resolved node when the effect completes. The renderer swaps the DOM in place on the second emission.
- **`Effect.flatMap((data) => h.div(...))`** builds the content node from the data. `h.*` returns a `Node`, which is an `Effect`, so it composes directly in the pipeline.
- **`Effect.catch((error) => node)`** converts the error channel into a fallback node, so the stream always yields something renderable. The failure never escapes to the mount.
- **Parallel loading is automatic:** place several async components as siblings and their fetches run concurrently, with no orchestration needed.

## Full example

The whole file set: `UserCard` mounted twice, one instance failing on purpose (`id: 3`) to show the fallback. Copy/paste runnable in a `vite` + `@weftui/core` + `@weftui/dom` project.

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Async user card</title>
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
 * Renders a loading placeholder, then a fetched user card, or an error
 * fallback if the fetch fails. Side-effect-free (no mount call), so
 * `main.ts` and any test can import `App` directly.
 */
import { h } from "@weftui/core";
import { Effect, pipe, Stream } from "effect";

interface User {
  id: number;
  name: string;
  email: string;
}

const fetchUser = (id: number): Effect.Effect<User, Error> =>
  Effect.gen(function* () {
    yield* Effect.sleep("1000 millis");
    if (id === 3) return yield* Effect.fail(new Error("User not found"));
    return { id, name: `User ${id}`, email: `user${id}@example.com` };
  });

const UserCard = ({ id }: { id: number }) =>
  Stream.concat(
    Stream.make(h.div({ class: "loading" }, `Loading user ${id}…`)),
    Stream.fromEffect(
      pipe(
        fetchUser(id),
        Effect.flatMap((user) => h.div({ class: "user-card" }, [h.h3(user.name), h.p(user.email)])),
        Effect.catch((error) => h.div({ class: "error" }, `Error: ${error.message}`)),
      ),
    ),
  );

export const App = () => h.div({ id: "app" }, [UserCard({ id: 1 }), UserCard({ id: 3 })]);
```

```typescript
// src/main.ts
/**
 * Browser entry: mounts the async user card demo into `#root`.
 */
import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root")!;

const app = WeftApp.make();
void Effect.runPromise(WeftApp.mount(app, App(), root));
```

## When to reach for a boundary instead

This is the raw, per-region pattern: each async sibling owns its own loading state and its own fallback. When several async siblings should share **one fallback** and swap in together, wrap them in a suspense boundary instead:

```typescript
import { Boundary, h } from "@weftui/core";

Boundary.suspend({ fallback: h.div({ class: "spinner" }, "Loading…") }, [
  UserCard({ id: 1 }),
  UserCard({ id: 2 }),
]);
```

`Boundary.suspend` waits for **all** children to emit before swapping in, so there's no partial flicker between siblings. See [Boundaries and Suspense](../explanation/boundaries-and-suspense.md) for the full model.

When the data must resolve on the **server** and replay on hydrate without a second request, use [`Boundary.rpc`](./load-data-with-rpc.md) instead. Both boundaries are client-only otherwise; this recipe is purely client-side.

## Blocking on navigation vs streaming in place

The `Stream.concat` placeholder above lives on a **child** node, so it always streams in after mount and never delays a navigation commit. If the component above is a route's leaf, moving the `fetchUser` call into the leaf's own **body** instead changes that:

```typescript
import { Component, h } from "@weftui/core";
import { Router } from "@weftui/router";
import { Schema } from "effect";

// Streaming: fetchUser lives on a child (UserCard); the leaf commits immediately.
const streamingLeaf = ({ path }: { path: { id: number } }) =>
  h.article([h.h1("User"), UserCard({ id: path.id })]);

// Blocking: fetchUser lives in the leaf's own body; navigation waits for it.
const blockingLeaf = Component.gen(function* () {
  const { id } = yield* Router.params({ id: Schema.NumberFromString });
  const user = yield* fetchUser(id);
  return yield* h.article([h.h1("User"), h.p(user.name)]);
});
```

- **`blockingLeaf`** is commit-blocking. Navigating to the route pre-runs its component effect to completion before the URL commits: the previous page stays mounted for the fetch, and [`Router.navigating`](../reference/router.md#routernavigating) reports the window.
- **`streamingLeaf`** is streaming. The leaf commits immediately and the region fills in place once `UserCard`'s effect resolves.

Choose blocking for **primary route content the page is meaningless without** (an article body, a user's profile). The old page stays visible with no blank or skeleton.

Choose streaming for **secondary or slow regions** where partial content is still useful (a comments panel, a "related" rail). The commit isn't held hostage by one slow fetch.

See [Show Navigation Progress](./show-navigation-progress.md) for rendering pending UI during the blocking window, and the router reference's [Blocking vs streaming data](../reference/router.md#blocking-vs-streaming-data) for the full model.

## See also

- [Boundaries and Suspense](../explanation/boundaries-and-suspense.md): coordinating multiple async regions
- [Reactive Primitives](../explanation/reactive-primitives.md): `Stream`/`Effect` as node-producing children
- [Show Navigation Progress](./show-navigation-progress.md): the pending signal for the commit-blocking window
- [examples/async-data-loading](../../examples/async-data-loading): loading states, retry, parallel and sequential loads with error boundaries
