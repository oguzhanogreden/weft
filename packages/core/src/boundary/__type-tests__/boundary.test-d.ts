// oxlint-disable no-unused-vars
import { Boundary, type Node } from "@weftui/core";
import { Data, Option } from "effect";

// ── Type equality helpers ─────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// ── Fixtures ─────────────────────────────────────────────────────────────────

class FooError extends Data.TaggedError("Foo")<{ msg: string }> {}
class BarError extends Data.TaggedError("Bar")<{ code: number }> {}

interface SomeService {
  readonly _tag: "SomeService";
}
interface OtherService {
  readonly _tag: "OtherService";
}

declare const fooChild: Node<FooError>;
declare const barChild: Node<BarError>;
declare const fallbackNode: Node<never>;
declare const fooChildWithR: Node<FooError, SomeService>;
declare const fallbackWithR: Node<never, OtherService>;

// ── catchAll ─────────────────────────────────────────────────────────────────

// Children's E is fully consumed; output E is never, R is never
const _catchAll = Boundary.catch({ fallback: (_e: FooError) => fallbackNode }, [fooChild]);
type _TCatchAll = Expect<Equal<typeof _catchAll, Node<never, never>>>;

// R from children propagates out
const _catchAllChildR = Boundary.catch({ fallback: (_e: FooError) => fallbackNode }, [
  fooChildWithR,
]);
type _TCatchAllChildR = Expect<Equal<typeof _catchAllChildR, Node<never, SomeService>>>;

// R from fallback propagates out
const _catchAllFallbackR = Boundary.catch({ fallback: (_e: FooError) => fallbackWithR }, [
  fooChild,
]);
type _TCatchAllFallbackR = Expect<Equal<typeof _catchAllFallbackR, Node<never, OtherService>>>;

// R from both children and fallback unions
const _catchAllBothR = Boundary.catch({ fallback: (_e: FooError) => fallbackWithR }, [
  fooChildWithR,
]);
type _TCatchAllBothR = Expect<
  Equal<typeof _catchAllBothR, Node<never, SomeService | OtherService>>
>;

// Empty children: C inferred as never[], ChildrenR must not leak unknown
const _catchAllEmpty = Boundary.catch({ fallback: (_e: never) => fallbackNode }, []);
type _TCatchAllEmpty = Expect<Equal<typeof _catchAllEmpty, Node<never, never>>>;

// @ts-expect-error — fallback parameter type does not match children's E
Boundary.catch({ fallback: (_e: BarError) => fallbackNode }, [fooChild]);

// ── catchAllCause ─────────────────────────────────────────────────────────────

// Children's E fully consumed; fallback receives full Cause
const _catchAllCause = Boundary.catchCause({ fallback: (_cause) => fallbackNode }, [fooChild]);
type _TCatchAllCause = Expect<Equal<typeof _catchAllCause, Node<never, never>>>;

// Empty children: ChildrenR must not leak unknown
const _catchAllCauseEmpty = Boundary.catchCause({ fallback: (_cause) => fallbackNode }, []);
type _TCatchAllCauseEmpty = Expect<Equal<typeof _catchAllCauseEmpty, Node<never, never>>>;

// R from children propagates through catchAllCause
const _catchAllCauseR = Boundary.catchCause({ fallback: (_cause) => fallbackNode }, [
  fooChildWithR,
]);
type _TCatchAllCauseR = Expect<Equal<typeof _catchAllCauseR, Node<never, SomeService>>>;

// ── catchTag ─────────────────────────────────────────────────────────────────

// Matched tag removed from output E; unmatched BarError remains; R is never
const _catchTag = Boundary.catchTag({ tag: "Foo", fallback: (_e: FooError) => fallbackNode }, [
  fooChild,
  barChild,
]);
type _TCatchTag = Expect<Equal<typeof _catchTag, Node<BarError, never>>>;

// Single match — all errors consumed
const _catchTagSingle = Boundary.catchTag(
  { tag: "Foo", fallback: (_e: FooError) => fallbackNode },
  [fooChild],
);
type _TCatchTagSingle = Expect<Equal<typeof _catchTagSingle, Node<never, never>>>;

// @ts-expect-error — "Baz" is not present in the children's error union
Boundary.catchTag({ tag: "Baz", fallback: (_e: never) => fallbackNode }, [fooChild]);

// ── catchTags ────────────────────────────────────────────────────────────────

// Both tags caught; output E is never
const _catchTags = Boundary.catchTags(
  {
    Foo: (_e: FooError) => fallbackNode,
    Bar: (_e: BarError) => fallbackNode,
  },
  [fooChild, barChild],
);
type _TCatchTags = Expect<Equal<typeof _catchTags, Node<never, never>>>;

// Only one tag caught; the other remains in output E
const _catchTagsPartial = Boundary.catchTags({ Foo: (_e: FooError) => fallbackNode }, [
  fooChild,
  barChild,
]);
type _TCatchTagsPartial = Expect<Equal<typeof _catchTagsPartial, Node<BarError, never>>>;

// ── catchSome ────────────────────────────────────────────────────────────────

// Children's E preserved in output (boundary may not handle the error)
const _catchSome = Boundary.catchSome({ fallback: (_e: FooError) => Option.none() }, [fooChild]);
type _TCatchSome = Expect<Equal<typeof _catchSome, Node<FooError, never>>>;

// Empty children: ChildrenE and ChildrenR must not leak unknown
const _catchSomeEmpty = Boundary.catchSome({ fallback: (_e: never) => Option.none() }, []);
type _TCatchSomeEmpty = Expect<Equal<typeof _catchSomeEmpty, Node<never, never>>>;

// R from children preserved when boundary is conditional
const _catchSomeR = Boundary.catchSome({ fallback: (_e: FooError) => Option.none() }, [
  fooChildWithR,
]);
type _TCatchSomeR = Expect<Equal<typeof _catchSomeR, Node<FooError, SomeService>>>;

// ── catchIf ──────────────────────────────────────────────────────────────────

// Children's E preserved in output (predicate may return false)
const _catchIf = Boundary.catchIf(
  {
    predicate: (_e: FooError) => true,
    fallback: (_e: FooError) => fallbackNode,
  },
  [fooChild],
);
type _TCatchIf = Expect<Equal<typeof _catchIf, Node<FooError, never>>>;

// Empty children: ChildrenE and ChildrenR must not leak unknown
const _catchIfEmpty = Boundary.catchIf(
  { predicate: (_e: never) => true, fallback: (_e: never) => fallbackNode },
  [],
);
type _TCatchIfEmpty = Expect<Equal<typeof _catchIfEmpty, Node<never, never>>>;

// R from children and fallback both propagate out
const _catchIfR = Boundary.catchIf(
  {
    predicate: (_e: FooError) => true,
    fallback: (_e: FooError) => fallbackWithR,
  },
  [fooChildWithR],
);
type _TCatchIfR = Expect<Equal<typeof _catchIfR, Node<FooError, SomeService | OtherService>>>;

// ── Node is an Effect, not a plain descriptor ────────────────────────────────

// @ts-expect-error — a plain descriptor object is not a Node (which is an Effect)
const _notANode: Node<never> = { type: "div", props: {} };
