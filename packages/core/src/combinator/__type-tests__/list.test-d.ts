// oxlint-disable no-unused-vars
/**
 * Type tests for `List.each` — item-type inference, E/R propagation across the
 * source and the render node, and `by` key typing.
 */

import { Effect, Stream, Subscribable } from "effect";
import { List } from "../list";
import { h } from "../element";
import type { Node } from "../types";

// =============================================================================
// Type equality helper
// =============================================================================

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// =============================================================================
// Mock services, errors, and item types
// =============================================================================

interface PersonService {
  readonly _: unique symbol;
}
interface RowService {
  readonly _: unique symbol;
}
class LoadError {
  readonly _tag = "LoadError";
}
class RowError {
  readonly _tag = "RowError";
}

interface Person {
  readonly id: string;
  readonly name: string;
}

declare const people: readonly Person[];
declare const peopleSet: ReadonlySet<Person>;
declare const peopleMap: ReadonlyMap<string, Person>;
declare const peopleStream: Stream.Stream<readonly Person[], LoadError, PersonService>;
declare const peopleEffect: Effect.Effect<readonly Person[], LoadError, PersonService>;
declare const peopleSub: Subscribable.Subscribable<readonly Person[], LoadError, PersonService>;

declare const nameStream: Stream.Stream<string, RowError, RowService>;

// =============================================================================
// Item-type inference — render's `item` parameter
// =============================================================================

// Test 1: static array ⇒ item is Person
List.each({ of: people }, (person) => {
  type _ = Expect<Equal<typeof person, Person>>;
  return h.li({}, person.name);
});

// Test 2: Stream<Person[]> ⇒ item is Person
List.each({ of: peopleStream }, (person) => {
  type _ = Expect<Equal<typeof person, Person>>;
  return h.li({}, person.name);
});

// Test 3: Effect<Person[]> ⇒ item is Person
List.each({ of: peopleEffect }, (person) => {
  type _ = Expect<Equal<typeof person, Person>>;
  return h.li({}, person.name);
});

// Test 4: Subscribable<Person[]> ⇒ item is Person
List.each({ of: peopleSub }, (person) => {
  type _ = Expect<Equal<typeof person, Person>>;
  return h.li({}, person.name);
});

// Test 5: Set<Person> (any Iterable) ⇒ item is Person
List.each({ of: peopleSet }, (person) => {
  type _ = Expect<Equal<typeof person, Person>>;
  return h.li({}, person.name);
});

// Test 6: Map<string, Person> ⇒ item is the [key, value] entry tuple
List.each({ of: peopleMap }, (entry) => {
  type _ = Expect<Equal<typeof entry, [string, Person]>>;
  return h.li({}, entry[1].name);
});

// Test 7: `index` is always number
List.each({ of: people }, (_person, index) => {
  type _ = Expect<Equal<typeof index, number>>;
  return h.li({}, String(index));
});

// =============================================================================
// E/R propagation
// =============================================================================

// Test 8: static of + static render ⇒ Node<never, never>
const _t8 = List.each({ of: people }, (person) => h.li({}, person.name));
type _T8 = Expect<Equal<typeof _t8, Node<never, never>>>;

// Test 9: Stream source contributes E/R
const _t9 = List.each({ of: peopleStream }, (person) => h.li({}, person.name));
type _T9 = Expect<Equal<typeof _t9, Node<LoadError, PersonService>>>;

// Test 10: Effect source contributes E/R
const _t10 = List.each({ of: peopleEffect }, (person) => h.li({}, person.name));
type _T10 = Expect<Equal<typeof _t10, Node<LoadError, PersonService>>>;

// Test 11: Subscribable source contributes E/R
const _t11 = List.each({ of: peopleSub }, (person) => h.li({}, person.name));
type _T11 = Expect<Equal<typeof _t11, Node<LoadError, PersonService>>>;

// Test 12: reactive child inside render contributes CE/CR
const _t12 = List.each({ of: people }, (_person) => h.li({}, [nameStream]));
type _T12 = Expect<Equal<typeof _t12, Node<RowError, RowService>>>;

// Test 13: source channels and render channels are unioned
const _t13 = List.each({ of: peopleStream }, (_person) => h.li({}, [nameStream]));
type _T13 = Expect<Equal<typeof _t13, Node<LoadError | RowError, PersonService | RowService>>>;

// =============================================================================
// `by` key typing
// =============================================================================

// Test 14: by omitted is valid, channels unchanged
const _t14 = List.each({ of: peopleStream }, (person) => h.li({}, person.name));
type _T14 = Expect<Equal<typeof _t14, Node<LoadError, PersonService>>>;

// Test 15: by projects item ⇒ types item as Person, index as number
const _t15 = List.each(
  {
    of: peopleStream,
    by: (person, index) => {
      type _P = Expect<Equal<typeof person, Person>>;
      type _I = Expect<Equal<typeof index, number>>;
      return person.id;
    },
  },
  (person) => h.li({}, person.name),
);
// by does not alter E/R
type _T15 = Expect<Equal<typeof _t15, Node<LoadError, PersonService>>>;

// Test 16: positional/index key compiles (the footgun is a runtime concern)
const _t16 = List.each({ of: people, by: (_person, index) => index }, (person) =>
  h.li({}, person.name),
);
type _T16 = Expect<Equal<typeof _t16, Node<never, never>>>;

// =============================================================================
// Invalid uses — @ts-expect-error assertions
// =============================================================================

// Test 17: render receiving the wrong item type
List.each({ of: people }, (person) => {
  // @ts-expect-error — Person has no `age` field
  const _age: number = person.age;
  return h.li({}, person.name);
});

// Test 18: `of` must be an Iterable source — a bare non-iterable object is rejected
// @ts-expect-error — `{ count: number }` is not a `Source<Iterable<...>>`
List.each({ of: { count: 1 } }, (item) => h.li({}, String(item)));
