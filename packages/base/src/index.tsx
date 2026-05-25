import { toStream } from "@effect-ui/core";
import type { JSXNode, MaybeReactive } from "@effect-ui/core/types";
import { Stream, pipe } from "effect";

/**
 * Props for {@link Card}. Inputs are `MaybeReactive<T>` (static or reactive);
 * the output is a plain callback. This is the recommended one-way default.
 */
export interface CardProps {
  /** Heading text — static or reactive; the renderer subscribes when reactive. */
  readonly title: MaybeReactive<string>;
  /** Invoked when the card is picked. */
  readonly onPick: () => void;
}

/**
 * Smoke example of a plain-function component consuming a `MaybeReactive` prop.
 *
 * `props.title` is forwarded straight into a slot (renderer auto-subscribes),
 * and also normalized with `toStream` to derive an uppercased variant —
 * demonstrating the two ways to consume a reactive prop.
 */
export function Card(props: CardProps): JSXNode {
  return (
    <div>
      <h2>{props.title}</h2>
      <p>
        {pipe(
          toStream(props.title),
          Stream.map((t) => t.toUpperCase()),
        )}
      </p>
      <button onclick={() => props.onPick()}>pick</button>
    </div>
  );
}
