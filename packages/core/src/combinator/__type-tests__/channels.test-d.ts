// oxlint-disable no-unused-vars
/**
 * Type tests for the `Node` channel accessors (`Node.Error` / `Node.Context`)
 * and their re-exports on the `List` and `Component` namespaces. A `Node`'s
 * success channel is fixed to `ElementDescriptor`, so only the error and
 * requirement channels are exposed.
 */

import { Effect, Stream } from "effect";
import type { Node } from "../types";
import { Component } from "../component";
import { List } from "../list";
import { h } from "../element";

// =============================================================================
// Type equality helper
// =============================================================================

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// =============================================================================
// Mock channels
// =============================================================================

interface RowService {
  readonly _: unique symbol;
}
class RowError {
  readonly _tag = "RowError";
}

type PlainNode = Node<RowError, RowService>;

// =============================================================================
// Node.Error / Node.Context
// =============================================================================

type _N1 = Expect<Equal<Node.Error<PlainNode>, RowError>>;
type _N2 = Expect<Equal<Node.Context<PlainNode>, RowService>>;
// A static node contributes `never` on both channels.
type _N3 = Expect<Equal<Node.Error<Node<never, never>>, never>>;
type _N4 = Expect<Equal<Node.Context<Node<never, never>>, never>>;

// =============================================================================
// List.Error / List.Context re-export the Node accessors identically
// =============================================================================

type _L1 = Expect<Equal<List.Error<PlainNode>, Node.Error<PlainNode>>>;
type _L2 = Expect<Equal<List.Context<PlainNode>, Node.Context<PlainNode>>>;

// Applied to a real `List.each` result.
declare const nameStream: Stream.Stream<string, RowError, RowService>;
const _list = List.each({ of: [{ id: "a" }] }, () => h.li({}, [nameStream]));
type _L3 = Expect<Equal<List.Error<typeof _list>, RowError>>;
type _L4 = Expect<Equal<List.Context<typeof _list>, RowService>>;

// =============================================================================
// Component.Error / Component.Context re-export the Node accessors identically
// =============================================================================

type _Co1 = Expect<Equal<Component.Error<PlainNode>, Node.Error<PlainNode>>>;
type _Co2 = Expect<Equal<Component.Context<PlainNode>, Node.Context<PlainNode>>>;

// Applied to the node a component call produces.
const Avatar = Component.make((props: { src: Stream.Stream<string, RowError, RowService> }) =>
  h.img({ src: props.src }),
);
const _avatarNode = Avatar({ src: nameStream });
type _Co3 = Expect<Equal<Component.Error<typeof _avatarNode>, RowError>>;
type _Co4 = Expect<Equal<Component.Context<typeof _avatarNode>, RowService>>;

// =============================================================================
// Event handler props surface their Effect E/R channels in the Node type
// =============================================================================

declare const handlerWithService: Effect.Effect<void, never, RowService>;
declare const handlerWithError: Effect.Effect<void, RowError, never>;

// Handler requiring a service ⇒ R surfaces on the node.
const _btnService = h.button({ onclick: () => handlerWithService }, ["go"]);
type _H1 = Expect<Equal<Node.Error<typeof _btnService>, never>>;
type _H2 = Expect<Equal<Node.Context<typeof _btnService>, RowService>>;

// Handler that can fail ⇒ E surfaces on the node.
const _btnError = h.button({ onclick: () => handlerWithError }, ["go"]);
type _H3 = Expect<Equal<Node.Error<typeof _btnError>, RowError>>;
type _H4 = Expect<Equal<Node.Context<typeof _btnError>, never>>;

// Plain void handler contributes nothing.
const _btnVoid = h.button(
  {
    onclick: () => {
      /* side effect only */
    },
  },
  ["go"],
);
type _H5 = Expect<Equal<Node.Error<typeof _btnVoid>, never>>;
type _H6 = Expect<Equal<Node.Context<typeof _btnVoid>, never>>;
