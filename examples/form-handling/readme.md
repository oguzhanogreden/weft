# Form Handling

## Overview

This example demonstrates reactive form handling with stream-based inputs, Schema validation, and Effect-powered submit handlers.

## Problem

Form handling in web apps requires managing input state, validation, and async submission. Traditional approaches use controlled components with state hooks, leading to verbose code and prop drilling.

## Solution

Weft enables reactive form patterns using `SubscriptionRef` and streams:

```typescript
import { h } from "@weftui/core";
import { Effect, SubscriptionRef, Stream } from "effect";

const ReactiveInput = () =>
  Effect.gen(function* () {
    const value = yield* SubscriptionRef.make("");

    return yield* h.div([
      h.input({
        type: "text",
        oninput: (e) => SubscriptionRef.set(value, e.currentTarget.value),
      }),
      h.div(["You typed: ", SubscriptionRef.changes(value)]),
    ]);
  });
```

## How It Works

1. `SubscriptionRef.make(initial)` creates reactive state for each field
2. `oninput` handler updates the ref on every keystroke
3. `SubscriptionRef.changes(ref)` streams the current value into the UI reactively
4. Derived streams compute validation, character counts, etc.
5. Form submit handlers can return Effects for async operations

## Benefits

- **Reactive by design**: No manual state synchronization
- **Derived state**: Compute validations declaratively from streams
- **Effect integration**: Submit handlers with async operations
- **Type-safe**: Full TypeScript support
- **Composable**: Combine streams for complex validation logic

## Usage Patterns

### Basic Reactive Input

```typescript
const value = yield * SubscriptionRef.make("");

h.input({
  type: "text",
  oninput: (e) => SubscriptionRef.set(value, e.currentTarget.value),
});

// Show current value reactively
h.div(["You typed: ", SubscriptionRef.changes(value)]);
```

### Schema Validation

```typescript
import { Result, Schema } from "effect";

const Email = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => (s.includes("@") ? undefined : "Must contain @"))),
  Schema.check(Schema.makeFilter((s) => (s.includes(".") ? undefined : "Must have domain"))),
);

const email = yield * SubscriptionRef.make("");

const validationStream = Stream.map(SubscriptionRef.changes(email), (value) => {
  if (!value) return null;
  const result = Schema.decodeUnknownResult(Email)(value);
  return Result.match(result, {
    onFailure: (e) => e.message.split(":").pop()?.trim() ?? "Invalid",
    onSuccess: () => null,
  });
});

h.input({
  type: "email",
  oninput: (e) => SubscriptionRef.set(email, (e.target as HTMLInputElement).value),
});
Stream.map(validationStream, (err) => (err ? h.span({ class: "error" }, err) : null));
```

### Character Counter

```typescript
const text = yield * SubscriptionRef.make("");
const countStream = Stream.map(SubscriptionRef.changes(text), (t) => t.length);
const remainingStream = Stream.map(countStream, (c) => 100 - c);

h.textarea({
  oninput: (e) => SubscriptionRef.set(text, (e.target as HTMLTextAreaElement).value),
});
h.span([remainingStream, " characters remaining"]);
```

### Effect Submit Handler

```typescript
h.form(
  {
    onsubmit: (e) => {
      e.preventDefault();
      return Effect.gen(function* () {
        yield* Effect.log("Submitting...");
        yield* submitForm();
        yield* Effect.log("Done!");
      });
    },
  },
  [...fields],
);
```

## When to Use

- Forms with real-time validation feedback
- Character counters and input constraints
- Live search with preview
- Multi-step forms with progress tracking
- Any form that benefits from reactive state
