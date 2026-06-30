/**
 * `reactive-counter` demo.
 *
 * The headline reactivity pattern: a `SubscriptionRef` signal whose `.changes`
 * stream drives a text node directly — no virtual DOM, no diffing. Clicking a
 * button updates the ref; the rendered value updates in place. SSR-rendered and
 * hydrated as an ordinary subtree of the page (no separate mount).
 */

import { h } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, Stream, SubscriptionRef } from "effect";

/** An increment/decrement counter driven by a `SubscriptionRef` signal. */
export const ReactiveCounter = (): Node =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    const increment = () => SubscriptionRef.update(count, (n) => n + 1);
    const decrement = () => SubscriptionRef.update(count, (n) => n - 1);

    return yield* h.div({ class: "demo demo-counter" }, [
      h.button(
        {
          type: "button",
          class: "demo-counter__btn",
          "aria-label": "Decrement",
          onclick: () => decrement(),
        },
        "−",
      ),
      h.span({ class: "demo-counter__value" }, [Stream.map(count.changes, (n) => String(n))]),
      h.button(
        {
          type: "button",
          class: "demo-counter__btn",
          "aria-label": "Increment",
          onclick: () => increment(),
        },
        "+",
      ),
    ]);
  });
