import { elementNode } from "./descriptor";
import type { Node } from "./types";
import type { Source } from "~/source/source";
import type { Effect, Stream, Subscribable } from "effect";

/**
 * Unique symbol identifying keyed-list nodes built by {@link List.each}. The
 * renderer special-cases descriptors carrying this `type`, mirroring how
 * `FRAGMENT` and the `Boundary` symbols are detected.
 */
export const LIST = Symbol("@effect-ui/core/list");

/**
 * Extract the emitted value type `A` from any {@link Source} kind. Stream/
 * Effect/Subscribable contribute their value channel; a static value is itself.
 * Checked in the same order as `OpenPropSource` so an `Effect` (which is itself
 * iterable for generators) never reaches the static fallback.
 */
type SourceValue<S> =
  S extends Stream.Stream<infer A, any, any>
    ? A
    : S extends Effect.Effect<infer A, any, any>
      ? A
      : S extends Subscribable.Subscribable<infer A, any, any>
        ? A
        : S;

/** Extract the error channel `E` from any {@link Source} kind; static ⇒ `never`. */
type SourceError<S> =
  S extends Stream.Stream<any, infer E, any>
    ? E
    : S extends Effect.Effect<any, infer E, any>
      ? E
      : S extends Subscribable.Subscribable<any, infer E, any>
        ? E
        : never;

/** Extract the requirement channel `R` from any {@link Source} kind; static ⇒ `never`. */
type SourceContext<S> =
  S extends Stream.Stream<any, any, infer R>
    ? R
    : S extends Effect.Effect<any, any, infer R>
      ? R
      : S extends Subscribable.Subscribable<any, any, infer R>
        ? R
        : never;

/** Element type carried by a list source — the element type of the emitted `Iterable`. */
type ItemOf<S> = SourceValue<S> extends Iterable<infer T> ? T : never;

/**
 * Keyed-list combinator namespace. The opt-in alternative to wholesale child
 * rebuilds: items are rendered once per key and reconciled across emissions.
 */
export namespace List {
  /**
   * Options for {@link each}.
   *
   * @typeParam S - The `of` source type (drives item/`E`/`R` inference).
   * @typeParam K - The key type produced by `by` (defaults to the item type).
   */
  export interface Options<S, K> {
    /**
     * The list source: a static `Iterable<T>`, or an `Effect`/`Stream`/
     * `Subscribable` of one. Each emission is materialized to an array to fix
     * order, then reconciled by key.
     */
    readonly of: S;
    /**
     * Projects an item to its reconciliation key, compared via Effect `Equal`
     * and hashed via `Hash`. Omitted ⇒ identity is the item itself. Use a
     * stable `t => t.id`; `(_, i) => i` is the index-key footgun (see specs).
     */
    readonly by?: (item: ItemOf<S>, index: number) => K;
  }

  /**
   * Declares a keyed reactive list region.
   *
   * `render` runs **once per key**; a persisted key keeps its DOM nodes and its
   * running subscription fibers across re-emits (it is never re-invoked). The
   * returned node's `E`/`R` are the union of the source channels and the
   * channels of the node `render` returns.
   *
   * @example
   * ```ts
   * List.each(
   *   { of: peopleStream, by: (p) => p.id },
   *   (person) => h.li({}, person.name),
   * );
   * ```
   */
  export function each<
    S extends Source.Source<Iterable<any>, any, any>,
    CE = never,
    CR = never,
    K = ItemOf<S>,
  >(
    options: Options<S, K>,
    render: (item: ItemOf<S>, index: number) => Node<CE, CR>,
  ): Node<SourceError<S> | CE, SourceContext<S> | CR> {
    return elementNode({
      type: LIST,
      props: { of: options.of, by: options.by, render } as Record<string, unknown>,
    });
  }
}
