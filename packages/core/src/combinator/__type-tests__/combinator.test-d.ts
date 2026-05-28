// oxlint-disable no-unused-vars
/**
 * Type tests for the combinator API.
 * Validates that E and R accumulate correctly through the tree,
 * and that both `() => h.div(...)` and `Effect.gen(function* () { yield* h.div(...) })`
 * infer correctly.
 */

import { Effect, Stream } from "effect";
import { h } from "../element";
import type { DOMNode, Node } from "../types";
import { Component } from "../component";

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

declare const userStream: Stream.Stream<string, never, UserService>;
declare const dbEffect: Effect.Effect<string, DbError, DbService>;
declare const themeStream: Stream.Stream<string, never, ThemeService>;

// =============================================================================
// Tests
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

// Test 10: custom component — R from reactive prop propagates out
interface TextFieldProps {
  name: string;
  value?: string | Stream.Stream<string, any, any>;
  onChange?: (value: string) => void;
}

const TextField = Component.gen(function* (_: TextFieldProps) {
  return yield* h.div({ class: "field" });
});

const _t10 = TextField({ name: "email", value: userStream });
type _T10 = Expect<Equal<typeof _t10, Node<never, UserService>>>;

// Test 11: custom component — static props, Node<never, never>
const _t11 = TextField({ name: "email", value: "static@example.com" });
type _T11 = Expect<Equal<typeof _t11, Node<never, never>>>;

// Test 12: custom component with its own internal R — unioned with caller's props R
interface ThemeService2 {
  readonly colors: Record<string, string>;
}
declare const themeStream2: Stream.Stream<string, never, ThemeService2>;

const ThemedField = Component.gen(function* (_props: TextFieldProps) {
  return yield* h.div({ class: themeStream2 });
});

const _t12 = ThemedField({ name: "email", value: userStream });
type _T12 = Expect<Equal<typeof _t12, Node<never, UserService | ThemeService2>>>;

// Test 13: Component.make — static props, Node<never, never>
const MakeField = Component.make((_props: TextFieldProps) => h.div({ class: "field" }));

const _t13 = MakeField({ name: "email", value: "static" });
type _T13 = Expect<Equal<typeof _t13, Node<never, never>>>;

// Test 14: Component.make — reactive prop R propagates out
const _t14 = MakeField({ name: "email", value: userStream });
type _T14 = Expect<Equal<typeof _t14, Node<never, UserService>>>;

// Test 15: Component.make — internal R unioned with caller's prop R
const MakeThemedField = Component.make((_props: TextFieldProps) => h.div({ class: themeStream2 }));

const _t15 = MakeThemedField({ name: "email", value: userStream });
type _T15 = Expect<Equal<typeof _t15, Node<never, UserService | ThemeService2>>>;

// Test 16: Component.make — E from internal effect propagates out
const MakeErrorField = Component.make((_props: TextFieldProps) =>
  Effect.flatMap(dbEffect, (val) => h.div({}, val)),
);

const _t16 = MakeErrorField({ name: "email" });
type _T16 = Expect<Equal<typeof _t16, Node<DbError, DbService>>>;

// Test 17: Component.make — E and R from both props and body unioned
const _t17 = MakeErrorField({ name: "email", value: userStream });
type _T17 = Expect<Equal<typeof _t17, Node<DbError, UserService | DbService>>>;
