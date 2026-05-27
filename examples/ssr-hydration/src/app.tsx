/**
 * The shared isomorphic `<App/>`.
 *
 * Rendered to hydratable HTML on the server (`entry-server.tsx`) and hydrated in
 * the browser (`entry-client.tsx`) from that same markup. The `{count.changes}`
 * region is the flash-free region: the server's first emission (`3`) matches the
 * client's first emission (`3`), so `hydrate` adopts the existing node in place
 * without re-rendering — node identity is preserved, no flicker.
 */

import { Component } from "@effect-ui/core";
import { Effect, SubscriptionRef } from "effect";

/**
 * Root component. Returns an Effect that owns a `SubscriptionRef` counter and
 * renders a heading, a static blurb, the reactive count region, and the
 * increment/decrement controls. Requires no services.
 */
export const App = Component.gen<{
  initialValue: number;
}>(function* (props) {
  const count = yield* SubscriptionRef.make(
    yield* Effect.orElse(props.initialValue.get, () => Effect.succeed(3)),
  );
  const increment = () => SubscriptionRef.update(count, (n) => n + 1);
  const decrement = () => SubscriptionRef.update(count, (n) => n - 1);

  return (
    <div>
      <h1>SSR + Hydration</h1>
      <p>
        This page was rendered to HTML on the server and hydrated in the browser. The counter below
        shows <code>3</code> before any JavaScript runs; once hydrated, the buttons work and the
        count node resumes in place — no flash.
      </p>
      <div class="count">{count.changes}</div>
      <button type="button" onclick={() => decrement()}>
        -
      </button>
      <button type="button" onclick={() => increment()}>
        +
      </button>
      <div>
        <span class="status" id="status">
          [SSR — not yet interactive]
        </span>
      </div>
    </div>
  );
});
