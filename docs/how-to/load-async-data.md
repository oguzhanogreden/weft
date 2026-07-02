---
title: Load Async Data
order: 9
section: how-to
description: Show a loading state then resolved content with Stream.concat, and turn a failed fetch into a fallback node with Effect.catchAll — all client-side.
---

# Load Async Data

**Goal:** render a loading placeholder, then the fetched content, and a fallback if the fetch fails — for data that loads **on the client**.

Return a `Stream<Node>` that emits the loading node first and the resolved node second, sequenced with `Stream.concat`. Handle failure inside the effect with `Effect.catchAll`, which maps the error to a fallback node.

```typescript
import { h } from "@weftui/core";
import { Effect, Stream } from "effect";

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
      fetchUser(id).pipe(
        Effect.flatMap((user) => h.div({ class: "user-card" }, [h.h3(user.name), h.p(user.email)])),
        Effect.catchAll((error) => h.div({ class: "error" }, `Error: ${error.message}`)),
      ),
    ),
  );
```

## How it works

- **`Stream.concat`** sequences two streams: `Stream.make(loadingNode)` emits once immediately, then `Stream.fromEffect(effect)` emits the resolved node when the effect completes. The renderer swaps the DOM in place on the second emission.
- **`Effect.flatMap((data) => h.div(...))`** builds the content node from the data — `h.*` returns a `Node`, which is an `Effect`, so it composes directly in the pipeline.
- **`Effect.catchAll((error) => node)`** converts the error channel into a fallback node, so the stream always yields something renderable. The failure never escapes to the mount.
- **Parallel loading is automatic:** place several async components as siblings and their fetches run concurrently — no orchestration needed.

## When to reach for a boundary instead

This is the raw, per-region pattern. When you need **one fallback for several async siblings** (all-or-nothing), use [`Boundary.suspend`](../explanation/boundaries-and-suspense.md). When the data must be resolved on the **server** and replayed on hydrate without a second request, use [`Boundary.rpc`](./load-data-with-rpc.md) instead — this recipe is purely client-side.

## See also

- [Boundaries and Suspense](../explanation/boundaries-and-suspense.md) — coordinating multiple async regions
- [Reactive Primitives](../explanation/reactive-primitives.md) — `Stream`/`Effect` as node-producing children
- [examples/async-data-loading](../../examples/async-data-loading) — loading states, retry, parallel and sequential loads with error boundaries
