// oxlint-disable no-unused-vars

/**
 * Compile-time type tests for the Component definition and prop-normalization
 * feature.  Use `@ts-expect-error` to assert that invalid usages fail to type-
 * check.
 *
 * Run with:  vp run typecheck.type-tests
 * (or included in vp check for the core package)
 */

import { Effect } from "effect";
import type { Scope, Stream, Subscribable } from "effect";
import {
  Component,
  NoPropValue,
  type PropsIn,
  type PropsOf,
  type Subscribables,
} from "~/component/component";
import type { JSXNode, JSXRequirements } from "~/types";
import type { Source } from "~/source";

// =============================================================================
// AC-1: Author face — every non-children slot is Subscribable<T, NoPropValue>
// =============================================================================

type WithName = { name: string };
declare const reactiveWithName: Subscribables<WithName>;

// name must be Subscribable<string, NoPropValue>
const _ac1_name: Subscribable.Subscribable<string, NoPropValue> = reactiveWithName.name;
// Its sub-properties must have the right types.
const _ac1_get: Effect.Effect<string, NoPropValue> = reactiveWithName.name.get;
const _ac1_changes: Stream.Stream<string, NoPropValue> = reactiveWithName.name.changes;

// Multiple non-children slots
type MultiSlot = { a: string; b: number };
declare const reactiveMulti: Subscribables<MultiSlot>;
const _ac1_a: Subscribable.Subscribable<string, NoPropValue> = reactiveMulti.a;
const _ac1_b: Subscribable.Subscribable<number, NoPropValue> = reactiveMulti.b;

// AC-1: children passes through unchanged — not wrapped in Subscribable
type WithChildrenJSX = { children: JSXNode };
declare const reactiveChildrenJSX: Subscribables<WithChildrenJSX>;
// Must be JSXNode, not Subscribable<JSXNode, NoPropValue>
const _ac1_children_jsx: JSXNode = reactiveChildrenJSX.children;

// =============================================================================
// AC-15: Render-prop / headless children pass through raw on both faces
// =============================================================================

type WithRenderProp = {
  children: (count: Subscribable.Subscribable<number>) => JSXNode;
};
declare const reactiveRenderProp: Subscribables<WithRenderProp>;
// Author sees the exact function type — not wrapped
const _ac15_renderProp: (count: Subscribable.Subscribable<number>) => JSXNode =
  reactiveRenderProp.children;

// Caller face: PropsIn leaves children untouched too
type CallerRenderProp = PropsIn<WithRenderProp>;
declare const callerRenderProp: CallerRenderProp;
// Must accept the raw function type (no Source<> widening)
const _ac15_callerChildren: (count: Subscribable.Subscribable<number>) => JSXNode =
  callerRenderProp.children;

// =============================================================================
// AC-2: Caller face — non-children slots widen to Source<T>
// =============================================================================

type CallerProps = PropsIn<{ name: string }>;

// string ∈ Source<string> ✓
const _ac2_string: CallerProps["name"] = "hello";

// Stream<string> ∈ Source<string> ✓
declare const _streamStr: Stream.Stream<string>;
const _ac2_stream: CallerProps["name"] = _streamStr;

// Effect<string> ∈ Source<string> ✓
declare const _effectStr: Effect.Effect<string>;
const _ac2_effect: CallerProps["name"] = _effectStr;

// Subscribable<string> ∈ Source<string> ✓
declare const _subStr: Subscribable.Subscribable<string>;
const _ac2_sub: CallerProps["name"] = _subStr;

// number ∉ Source<string> ✗
// @ts-expect-error - number is not assignable to Source<string>
const _ac2_reject_number: CallerProps["name"] = 42;

// Stream<number> ∉ Source<string> ✗
declare const _streamNum: Stream.Stream<number>;
// @ts-expect-error - Stream<number> is not assignable to Source<string>
const _ac2_reject_stream_wrong_type: CallerProps["name"] = _streamNum;

// AC-2: children is NOT widened on the caller face
type CallerWithChildren = PropsIn<{ children: JSXNode }>;
declare const callerWithChildren: CallerWithChildren;
// Must be JSXNode exactly — not Source<JSXNode>
const _ac2_children_passthrough: JSXNode = callerWithChildren.children;

// =============================================================================
// AC-16: Honest signature — direct Component call type-checks
// =============================================================================

declare const MyComp: Component<{ name: string; count: number }>;

// Direct call with PropsIn<P> — string satisfies Source<string>, etc.
const _ac16_call = MyComp({ name: "hello", count: 42 });

// Return type is Effect<JSXNode, never, JSXRequirements | Scope.Scope>
// (body errors are erased at the component boundary — they become fiber failures)
const _ac16_ret: Effect.Effect<JSXNode, never, JSXRequirements | Scope.Scope> = _ac16_call;

// PropsOf round-trips the raw shape
type _AC16_Raw = PropsOf<typeof MyComp>;
declare const _ac16_raw: _AC16_Raw;
const _ac16_name: string = _ac16_raw.name;
const _ac16_count: number = _ac16_raw.count;

// =============================================================================
// AC-1 + AC-2: Component.gen body receives Reactive<P>; result is Component<P>
// =============================================================================

// Verify the author-facing experience compiles end-to-end.
const _TestComp = Component.gen<{ label: string }>(function* (props) {
  // props.label must be Subscribable<string, NoPropValue>
  const _subCheck: Subscribable.Subscribable<string, NoPropValue> = props.label;
  const _getCheck: Effect.Effect<string, NoPropValue> = props.label.get;
  const _changesCheck: Stream.Stream<string, NoPropValue> = props.label.changes;

  // yield* .get is legal (satisfies JSXRequirements | Scope constraint)
  yield* props.label.get;
  return null;
});

// Result is Component<{ label: string }>
const _compType: Component<{ label: string }> = _TestComp;

// =============================================================================
// AC-16 cont: Component.gen body errors are erased at the component boundary
// =============================================================================

// A body that yields an Effect with a typed error compiles because the body
// generator accepts any yielded effect type — errors are erased at the
// boundary (they become fiber failures, not typed errors on the component).
const _ErrorComp = Component.gen<{ x: number }>(function* (props) {
  // This yields an Effect<never, Error, ...> — should compile without issue
  // because the body's error channel is erased.
  yield* Effect.fail(new Error("example"));
  return null;
});
const _errorCompType: Component<{ x: number }> = _ErrorComp;
