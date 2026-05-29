// oxlint-disable no-unused-vars
/**
 * Type tests for the combinator API.
 * Validates that E and R accumulate correctly through the tree,
 * and that both `() => h.div(...)` and `Effect.gen(function* () { yield* h.div(...) })`
 * infer correctly.
 */

import { Effect, Stream } from "effect";
import { h } from "./element";
import type { Child, DOMNode, Node } from "./types";
import { Component } from "./component";

// =============================================================================
// Type equality helper
// =============================================================================

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// =============================================================================
// Mock services for tests
// =============================================================================

interface UserService {
  readonly users: readonly string[];
}
interface DbService {
  readonly db: unknown;
}
class DbError {
  readonly _tag = "DbError";
}
interface ThemeService {
  readonly theme: string;
}
interface ThemeService2 {
  readonly colors: Record<string, string>;
}

interface TextFieldProps {
  name: string;
  value?: string | Stream.Stream<string, any, any>;
  onChange?: (value: string) => void;
}

declare const userStream: Stream.Stream<string, never, UserService>;
declare const dbEffect: Effect.Effect<string, DbError, DbService>;
declare const themeStream: Stream.Stream<string, never, ThemeService>;
declare const themeStream2: Stream.Stream<string, never, ThemeService2>;

// =============================================================================
// h.* element tests
// =============================================================================

// Test 1: static props — Node<never, never>
const _t1 = h.div({ id: "app", class: "container" }, [h.span({ class: "title" }, "Hello")]);
type _T1 = Expect<Equal<typeof _t1, Node<never, never>>>;

// Test 2: reactive prop — R accumulates from prop value
const _t2 = h.div({ class: themeStream });
type _T2 = Expect<Equal<typeof _t2, Node<never, ThemeService>>>;

// Test 3: R accumulates from child stream directly
const _t3 = h.div({ class: "container" }, [userStream]);
type _T3 = Expect<Equal<typeof _t3, Node<never, UserService>>>;

// Test 4: R from reactive prop + R from child — union
const _t4 = h.div({ class: themeStream }, [userStream]);
type _T4 = Expect<Equal<typeof _t4, Node<never, ThemeService | UserService>>>;

// Test 5: E and R accumulate across siblings
const _t5 = h.div({}, [userStream, dbEffect]);
type _T5 = Expect<Equal<typeof _t5, Node<DbError, UserService | DbService>>>;

// Test 6: plain function wrapper — R preserved on return type
const _t6 = () => h.div({}, [userStream]);
type _T6 = Expect<Equal<typeof _t6, () => Node<never, UserService>>>;

// Test 7: Effect.gen — yield* works, R propagates into generator
const _t7 = Effect.gen(function* () {
  return yield* h.div({}, [userStream]);
});
type _T7 = Expect<Equal<typeof _t7, Effect.Effect<DOMNode, never, UserService>>>;

// Test 8: nesting — R propagates through levels
const _t8 = h.div({}, [h.div({}, [userStream]), dbEffect]);
type _T8 = Expect<Equal<typeof _t8, Node<DbError, UserService | DbService>>>;

// Test 9: children only, no props
const _t9 = h.div([userStream]);
type _T9 = Expect<Equal<typeof _t9, Node<never, UserService>>>;

// =============================================================================
// Component.gen
// =============================================================================

// --- Component.gen: props only ---

const GenField = Component.gen(function* (_: TextFieldProps) {
  return yield* h.div({ class: "field" });
});

// Test 10: reactive prop — R propagates out
const _t10 = GenField({ name: "email", value: userStream });
type _T10 = Expect<Equal<typeof _t10, Node<never, UserService>>>;

// Test 11: static props — Node<never, never>
const _t11 = GenField({ name: "email", value: "static@example.com" });
type _T11 = Expect<Equal<typeof _t11, Node<never, never>>>;

// Test 12: internal R unioned with caller's prop R
const GenThemedField = Component.gen(function* (_props: TextFieldProps) {
  return yield* h.div({ class: themeStream2 });
});

const _t12 = GenThemedField({ name: "email", value: userStream });
type _T12 = Expect<Equal<typeof _t12, Node<never, UserService | ThemeService2>>>;

// --- Component.gen: children array ---

// Test 13: E from child effect unioned through children array
const GenWithChildren = Component.gen(function* (_props, children) {
  return yield* h.div({ class: "field" }, children);
});

const _t13 = GenWithChildren({}, [
  Effect.gen(function* () {
    if (Math.random() > 0.5) yield* Effect.fail("t13" as const);
    return yield* h.span({});
  }),
]);
type _T13 = Expect<Equal<typeof _t13, Node<"t13", never>>>;

// --- Component.gen: function children ---

// Test 14: function-as-children — E from yielded child, R from reactive prop unioned
const GenWithFnChildren = Component.gen(function* (
  _props: { value?: string | Stream.Stream<string, any, any> },
  children: (message: string) => readonly Child[],
) {
  return yield* h.div({ class: "field" }, children("message"));
});

const _t14 = GenWithFnChildren({ value: userStream }, (message) => [
  h.div({}, "Static child"),
  Effect.gen(function* () {
    if (Math.random() > 0.5) yield* Effect.fail("t14" as const);
    return yield* h.span({}, message);
  }),
]);
type _T14 = Expect<Equal<typeof _t14, Node<"t14", UserService>>>;

// =============================================================================
// Component.make
// =============================================================================

// --- Component.make: props only ---

const MakeField = Component.make((_props: TextFieldProps) => h.div({ class: "field" }));

// Test 15: static props — Node<never, never>
const _t15 = MakeField({ name: "email", value: "static" });
type _T15 = Expect<Equal<typeof _t15, Node<never, never>>>;

// Test 16: reactive prop R propagates out
const _t16 = MakeField({ name: "email", value: userStream });
type _T16 = Expect<Equal<typeof _t16, Node<never, UserService>>>;

// Test 17: internal R unioned with caller's prop R
const MakeThemedField = Component.make((_props: TextFieldProps) => h.div({ class: themeStream2 }));

const _t17 = MakeThemedField({ name: "email", value: userStream });
type _T17 = Expect<Equal<typeof _t17, Node<never, UserService | ThemeService2>>>;

// Test 18: E from internal effect propagates out
const MakeErrorField = Component.make((_props: TextFieldProps) =>
  Effect.flatMap(dbEffect, (val) => h.div({}, val)),
);

const _t18 = MakeErrorField({ name: "email" });
type _T18 = Expect<Equal<typeof _t18, Node<DbError, DbService>>>;

// Test 19: E and R from both props and body unioned
const _t19 = MakeErrorField({ name: "email", value: userStream });
type _T19 = Expect<Equal<typeof _t19, Node<DbError, UserService | DbService>>>;

// --- Component.make: children array ---

// Test 20: E from child effect unioned through children array
const MakeWithChildren = Component.make((_props, children: readonly Child[]) =>
  h.div({ class: "field" }, children),
);

const _t20 = MakeWithChildren({}, [
  Effect.gen(function* () {
    if (Math.random() > 0.5) yield* Effect.fail("t20" as const);
    return yield* h.span({});
  }),
]);
type _T20 = Expect<Equal<typeof _t20, Node<"t20", never>>>;

// --- Component.make: function children ---

// Test 21: function-as-children — E from yielded child, R from reactive prop unioned
const MakeWithFnChildren = Component.make(
  (
    _props: { value?: string | Stream.Stream<string, any, any> },
    children: (message: string) => readonly Child[],
  ) => h.div({ class: "field" }, children("message")),
);

const _t21 = MakeWithFnChildren({ value: userStream }, (message) => [
  h.div({}, "Static child"),
  Effect.gen(function* () {
    if (Math.random() > 0.5) yield* Effect.fail("t21" as const);
    return yield* h.span({}, message);
  }),
]);
type _T21 = Expect<Equal<typeof _t21, Node<"t21", UserService>>>;

// =============================================================================
// Invalid use of children — @ts-expect-error assertions
// =============================================================================

// --- h.* element children ---

// Test 22: arbitrary object is not a Child
// @ts-expect-error — `{}` is not assignable to `Child`
h.div({}, [{}]);

// Test 23: a bare function is not a Child
// @ts-expect-error — `() => Node` is not assignable to `Child`
h.div({}, [() => h.span({})]);

// Test 24a: a string is a valid first argument (single static child)
h.div("valid first arg");

// Test 24b: a number is a valid first argument (single static child)
h.div(42);

// Test 25: a Symbol is not a Child
// @ts-expect-error — `symbol` is not assignable to `Child`
h.div({}, [Symbol("x")]);

// --- Component children: array vs function mismatches ---

// Default `Children` for a gen component with no children typed is `readonly Child[]`,
// so passing a function should fail.
const GenArrayOnly = Component.gen(function* (_props: Record<string, never>) {
  return yield* h.div({});
});

// Test 26: array-children component invoked with a function
// @ts-expect-error — function not assignable to `readonly Child[]`
GenArrayOnly({}, () => [h.span({})]);

// A component that declares function-children should reject array literals.
const GenFnOnly = Component.gen(function* (
  _props: Record<string, never>,
  _kids: (msg: string) => readonly Child[],
) {
  return yield* h.div({});
});

// Test 27: function-children component invoked with an array
// @ts-expect-error — array not assignable to `(msg: string) => readonly Child[]`
GenFnOnly({}, [h.span({})]);

// Test 28: function-children — wrong return type (string instead of Child[])
// @ts-expect-error — `string` is not assignable to `readonly Child[]`
GenFnOnly({}, (_msg: string) => "not an array");

// Test 29: function-children — wrong child shape inside returned array
// @ts-expect-error — `{}` is not assignable to `Child`
GenFnOnly({}, (_msg: string) => [{}]);

// Mirror Component.make: array-only declaration rejects functions.
const MakeArrayOnly = Component.make((_props: Record<string, never>) => h.div({}));

// Test 30: Component.make array-children — function rejected
// @ts-expect-error — function not assignable to `readonly Child[]`
MakeArrayOnly({}, () => [h.span({})]);

// Mirror Component.make: function-only declaration rejects arrays.
const MakeFnOnly = Component.make(
  (_props: Record<string, never>, _kids: (msg: string) => readonly Child[]) => h.div({}),
);

// Test 31: Component.make function-children — array rejected
// @ts-expect-error — array not assignable to `(msg: string) => readonly Child[]`
MakeFnOnly({}, [h.span({})]);
