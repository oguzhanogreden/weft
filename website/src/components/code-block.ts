/**
 * Code block component.
 *
 * Shared chrome for a highlighted, copyable code pane: a top bar with an optional
 * language label and a copy button, over a `pre > code` holding the pre-highlighted
 * Shiki `tokens`. Highlighting is already baked into the tokens at build time
 * (see the markdown loader); this component only wraps and adds interaction.
 *
 * Used by `render-hast` for plain fenced code and by the `demo` component for the
 * code half of a live demo. On the server the copy button renders inert (no
 * clipboard); it activates on hydrate, and server/client markup is identical (the
 * button and its initial "Copy" label are present in both).
 */

import { Component, h } from "@weftui/core";
import type { Node, Renderable } from "@weftui/core";
import { Effect, Stream, SubscriptionRef, pipe } from "effect";

/** How long the "Copied" confirmation stays up before reverting. */
const COPIED_DURATION = "1500 millis";

export type CodeBlockProps = {
  /** Pre-highlighted hast children (rendered via `renderHast`), placed inside `<code>`. */
  readonly tokens: readonly Renderable[];
  /** Optional language label shown top-right (e.g. `"ts"`). */
  readonly lang?: string;
  /** Raw source text, copied to the clipboard by the copy button. */
  readonly raw: string;
};

/**
 * A highlighted, copyable code pane.
 *
 * @param props.tokens pre-highlighted code children
 * @param props.lang optional language label
 * @param props.raw raw source for the copy button
 */
export const CodeBlock = Component.gen(function* (props: CodeBlockProps) {
  const isEmpty = props.raw === "";
  const copied = yield* SubscriptionRef.make(false);

  // Effect-returning click handler: copy to clipboard, flash "Copied", then revert.
  // Clipboard failures (e.g. permission denied) are swallowed as a non-fatal state.
  const copy = (): Effect.Effect<void> =>
    pipe(
      Effect.tryPromise(() => navigator.clipboard.writeText(props.raw)),
      Effect.flatMap(() =>
        Effect.gen(function* () {
          yield* SubscriptionRef.set(copied, true);
          yield* Effect.sleep(COPIED_DURATION);
          yield* SubscriptionRef.set(copied, false);
        }),
      ),
      Effect.catchAll(() => Effect.void),
    );

  const label = Stream.map(copied.changes, (done) => (done ? "Copied" : "Copy"));

  // `code-block` is a semantic (non-styling) hook: tests select on it and the
  // demo component flush-overrides it. `not-prose` exempts the pane from the
  // Typography plugin so Shiki tokens keep their inline colors.
  return yield* h.figure(
    {
      class:
        "code-block not-prose my-4 overflow-hidden rounded-lg border border-slate-7 bg-slate-2",
    },
    [
      h.figcaption(
        {
          class:
            "flex items-center justify-end gap-2 border-b border-slate-7 bg-slate-3 px-2.5 py-1.5",
        },
        [
          props.lang === undefined
            ? null
            : h.span(
                {
                  class:
                    "code-block-lang mr-auto font-mono text-xs uppercase tracking-wide text-slate-11",
                },
                props.lang,
              ),
          h.button(
            {
              type: "button",
              class: "btn btn-ghost btn-xs",
              "aria-label": "Copy code",
              disabled: isEmpty,
              onclick: isEmpty ? null : () => copy(),
            },
            [label],
          ),
        ],
      ),
      h.pre({ class: "m-0 overflow-x-auto px-4 py-3.5 font-mono text-sm leading-relaxed" }, [
        h.code([...props.tokens]),
      ]),
    ],
  ) satisfies Node;
});
