import { Boundary, type Node } from "@effect-ui/core";
import { Data, Option } from "effect";

// ── Fixtures ─────────────────────────────────────────────────────────────────

class FooError extends Data.TaggedError("Foo")<{ msg: string }> {}
class BarError extends Data.TaggedError("Bar")<{ code: number }> {}

declare const fooChild: Node<FooError>;
declare const barChild: Node<BarError>;
declare const fallbackNode: Node<never>;

// ── catchAll ─────────────────────────────────────────────────────────────────

// Children's E is fully consumed; output E is never
const _catchAll: Node<never> = Boundary.catchAll({ fallback: (_e: FooError) => fallbackNode }, [
  fooChild,
]);

// @ts-expect-error — fallback parameter type does not match children's E
Boundary.catchAll({ fallback: (_e: BarError) => fallbackNode }, [fooChild]);

// ── catchAllCause ─────────────────────────────────────────────────────────────

// Children's E fully consumed; fallback receives Cause
const _catchAllCause: Node<never> = Boundary.catchAllCause({ fallback: (_cause) => fallbackNode }, [
  fooChild,
]);

// ── catchTag ─────────────────────────────────────────────────────────────────

// Matched tag removed from output E; unmatched (BarError) remains
const _catchTag: Node<BarError> = Boundary.catchTag(
  { tag: "Foo", fallback: (_e: FooError) => fallbackNode },
  [fooChild, barChild],
);

// @ts-expect-error — "Baz" is not present in the children's error union
Boundary.catchTag({ tag: "Baz", fallback: (_e: never) => fallbackNode }, [fooChild]);

// ── catchTags ────────────────────────────────────────────────────────────────

// Both tags caught; output E is never
const _catchTags: Node<never> = Boundary.catchTags(
  {
    Foo: (_e: FooError) => fallbackNode,
    Bar: (_e: BarError) => fallbackNode,
  },
  [fooChild, barChild],
);

// Only one tag caught; the other remains in output E
const _catchTagsPartial: Node<BarError> = Boundary.catchTags(
  { Foo: (_e: FooError) => fallbackNode },
  [fooChild, barChild],
);

// ── catchSome ────────────────────────────────────────────────────────────────

// Children's E preserved in output (boundary may not handle the error)
const _catchSome: Node<FooError> = Boundary.catchSome(
  { fallback: (_e: FooError) => Option.none() },
  [fooChild],
);

// ── catchIf ──────────────────────────────────────────────────────────────────

// Children's E preserved in output (predicate may return false)
const _catchIf: Node<FooError> = Boundary.catchIf(
  {
    predicate: (_e: FooError) => true,
    fallback: (_e: FooError) => fallbackNode,
  },
  [fooChild],
);

// ── Node is an Effect, not a plain descriptor ────────────────────────────────

// @ts-expect-error — a plain descriptor object is not a Node (which is an Effect)
const _notANode: Node<never> = { type: "div", props: {} };

// Suppress "declared but never read" errors for the valid assignments above
void _catchAll;
void _catchAllCause;
void _catchTag;
void _catchTags;
void _catchTagsPartial;
void _catchSome;
void _catchIf;
void _notANode;
