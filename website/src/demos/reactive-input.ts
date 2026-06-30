/**
 * `reactive-input` demo.
 *
 * A controlled input whose `SubscriptionRef` value drives a derived validation
 * stream: the message and its color are pure functions of the current value,
 * recomputed on every keystroke via `Stream.map` over `value.changes`. Shows that
 * derived UI state is just a stream transformation, with no separate state library.
 */

import { h } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Effect, Stream, SubscriptionRef } from "effect";

/** Minimum length considered "valid" for the demo's feedback. */
const MIN_LENGTH = 3;

/** A controlled text input with live, derived validation feedback. */
export const ReactiveInput = (): Node =>
  Effect.gen(function* () {
    const value = yield* SubscriptionRef.make("");
    const onInput = (event: Event) =>
      SubscriptionRef.set(value, (event.target as HTMLInputElement).value);

    const message = Stream.map(value.changes, (text) =>
      text.length === 0
        ? "Type something…"
        : text.length < MIN_LENGTH
          ? `Keep going… (${MIN_LENGTH - text.length} more)`
          : `Looks good — ${text.length} characters`,
    );
    const isValid = Stream.map(value.changes, (text) => text.length >= MIN_LENGTH);

    return yield* h.div({ class: "demo demo-input" }, [
      h.input({
        type: "text",
        class: "demo-input__field",
        placeholder: "Type here…",
        value: value.changes,
        oninput: onInput,
      }),
      h.p(
        {
          class: "demo-input__msg",
          style: { color: Stream.map(isValid, (ok) => (ok ? "#3fb950" : "#8b949e")) },
        },
        [message],
      ),
    ]);
  });
