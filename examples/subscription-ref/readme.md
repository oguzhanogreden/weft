# SubscriptionRef (Reactive Signals)

## Overview

This example demonstrates using Effect's `SubscriptionRef` as a reactive state primitive, similar to signals in SolidJS or stores in Svelte.

## Problem

Reactive state management typically requires external libraries (Redux, MobX, Zustand) or framework-specific solutions. Effect provides `SubscriptionRef` as a built-in reactive primitive that integrates naturally with the Effect ecosystem.

## Solution

`SubscriptionRef` is a mutable reference; `SubscriptionRef.changes(ref)` returns a `Stream` you pass directly as a child or prop:

```typescript
import { h } from "@weftui/core";
import { Effect, SubscriptionRef } from "effect";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    const increment = () => SubscriptionRef.update(count, (n) => n + 1);

    return yield* h.div([
      h.span([SubscriptionRef.changes(count)]),
      h.button({ onclick: () => increment() }, "+"),
    ]);
  });
```

## How It Works

1. `SubscriptionRef.make(initial)` creates a ref with initial value
2. `SubscriptionRef.changes(ref)` returns a `Stream` that emits the current value and all future updates
3. `SubscriptionRef.set(ref, value)` replaces the current value
4. `SubscriptionRef.update(ref, fn)` derives the next value from the current one
5. Derived streams use `Stream.map` or other Stream operators on `SubscriptionRef.changes(ref)`

## Benefits

- **Effect-native**: Built into Effect, no external dependencies
- **Type-safe**: Full TypeScript support for state shape
- **Composable**: Combine refs with all Stream operators
- **Efficient**: Only subscribers receive updates
- **Familiar**: Similar mental model to SolidJS signals

## Usage Patterns

### Basic Counter

```typescript
const count = yield* SubscriptionRef.make(0);

// Display current value
h.span([SubscriptionRef.changes(count)]);

// Update
h.button({ onclick: () => SubscriptionRef.update(count, (n) => n + 1) }, "+");
```

### Derived State

```typescript
const count = yield* SubscriptionRef.make(0);
const doubled = Stream.map(SubscriptionRef.changes(count), (n) => n * 2);
const isEven = Stream.map(SubscriptionRef.changes(count), (n) => (n % 2 === 0 ? "Yes" : "No"));

h.p(["Doubled: ", doubled]);
h.p(["Even: ", isEven]);
```

### Object State with Schema Validation

```typescript
import { Result, Schema } from "effect";

const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => (s.length >= 2 ? undefined : "Min 2 chars"))),
);

const validate = <A, I>(schema: Schema.Codec<A, I>, value: I): string | null => {
  if (!value) return null;
  const result = Schema.decodeUnknownResult(schema)(value);
  return Result.match(result, {
    onFailure: (e) => e.message.split(":").pop()?.trim() ?? "Invalid",
    onSuccess: () => null,
  });
};

const form = yield* SubscriptionRef.make({
  name: "",
  errors: { name: null as string | null },
});

const updateName = (name: string) =>
  SubscriptionRef.update(form, (state) => ({
    ...state,
    name,
    errors: { ...state.errors, name: validate(Name, name) },
  }));

h.input({ oninput: (e) => updateName((e.target as HTMLInputElement).value) });
Stream.map(SubscriptionRef.changes(form), (s) =>
  s.errors.name ? h.span({ class: "error" }, s.errors.name) : null,
);
```

### Combining Multiple Refs

```typescript
const firstName = yield* SubscriptionRef.make("");
const lastName = yield* SubscriptionRef.make("");

const fullName = Stream.zipLatestWith(
  SubscriptionRef.changes(firstName),
  SubscriptionRef.changes(lastName),
  (first, last) => `${first} ${last}`.trim(),
);

h.span(["Full name: ", fullName]);
```

### Array State

```typescript
const todos = yield* SubscriptionRef.make<Todo[]>([]);

const addTodo = (text: string) =>
  SubscriptionRef.update(todos, (list) => [...list, { id: Date.now(), text, done: false }]);

const toggleTodo = (id: number) =>
  SubscriptionRef.update(todos, (list) =>
    list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
  );
```

## Comparison with SolidJS Signals

| SolidJS                         | Effect SubscriptionRef                        |
| -------------------------------- | ---------------------------------------------- |
| `createSignal(0)`               | `SubscriptionRef.make(0)`                     |
| `count()`                       | `SubscriptionRef.changes(count)` (stream)     |
| `setCount(5)`                   | `SubscriptionRef.set(count, 5)`               |
| `setCount(n => n + 1)`          | `SubscriptionRef.update(count, n => n + 1)`   |
| `createMemo(() => count() * 2)` | `Stream.map(SubscriptionRef.changes(count), n => n * 2)` |

## When to Use

- Component-local state that needs to be reactive
- Form state with validation
- Lists/arrays that change over time
- Any state shared between event handlers and rendering
- When you want Effect integration in state management
