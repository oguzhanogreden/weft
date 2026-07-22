---
title: Handle Forms
order: 8
section: how-to
description: Build a controlled form with SubscriptionRef field state, reactive Schema validation, and an Effect-returning submit handler.
---

# Handle Forms

**Goal:** a controlled form whose inputs drive `SubscriptionRef` state, whose errors update reactively as the user types, and whose submit runs an `Effect`.

```typescript
import { h } from "@weftui/core";
import { Effect, SubscriptionRef } from "effect";

const Field = () =>
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

Each field is a `SubscriptionRef`: `oninput` writes it, `SubscriptionRef.changes` streams it back into the tree. `e.currentTarget` is typed to the element itself (`HTMLInputElement` here), so no cast is needed.

## Reactive validation

Derive an error stream from the field's `changes`. Decode with [`Schema`](https://effect.website/docs/schema/introduction) and turn the `Result` into UI with `Result.match`:

```typescript
import { Result, Schema, Stream, SubscriptionRef } from "effect";

const Email = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => (s.includes("@") ? undefined : "Must contain @"))),
  Schema.check(Schema.makeFilter((s) => (s.includes(".") ? undefined : "Must contain a domain"))),
);

const error = Stream.map(SubscriptionRef.changes(email), (value) => {
  if (value.length === 0) return null; // don't nag an empty field
  return Result.match(Schema.decodeUnknownResult(Email)(value), {
    onFailure: (e) => e.message.split(":").pop()?.trim() ?? "Invalid",
    onSuccess: () => null,
  });
});

h.span([Stream.map(error, (err) => (err ? h.span({ class: "error-text" }, err) : null))]);
```

This re-runs on every keystroke, not just on blur or submit. A node or `null` in a child slot renders the error or nothing.

## Submit as an Effect

`onsubmit` calls `e.preventDefault()`, then **returns** an `Effect` (it is not `yield*`-ed inline). The renderer runs it in a detached fiber:

```typescript
import { Effect, SubscriptionRef } from "effect";

h.form(
  {
    onsubmit: (e) => {
      e.preventDefault();
      return Effect.gen(function* () {
        yield* SubscriptionRef.set(status, "Submitting…");
        yield* Effect.sleep("1500 millis");
        yield* SubscriptionRef.set(status, "Login successful!");
      });
    },
  },
  [h.input({ type: "email" }), h.button({ type: "submit" }, "Login")],
);
```

Read a field imperatively inside the handler with `SubscriptionRef.get`, rather than threading its current value in from outside:

```typescript
onsubmit: (e) => {
  e.preventDefault();
  return Effect.gen(function* () {
    const u = yield* SubscriptionRef.get(usernameRef);
    const p = yield* SubscriptionRef.get(passwordRef);
    yield* login(u, p);
  });
},
```

## Cross-field validation

Combine two fields' `changes` streams with `Stream.zipLatestWith` before mapping to a result:

```typescript
import { Stream, SubscriptionRef } from "effect";

const isValid = Stream.zipLatestWith(
  SubscriptionRef.changes(usernameRef),
  SubscriptionRef.changes(passwordRef),
  (u, p) => u.length > 0 && p.length > 0,
);

h.button({ type: "submit" }, [
  Stream.map(isValid, (valid) => (valid ? "Register" : "Fill all fields")),
]);
```

Nest another `zipLatestWith` to bring in a third field.

## Complete example

A login form: one validated email field, a submit button disabled by nothing (validity only changes its label), and a status line. This is the whole file set, copy/paste runnable in a `vite` + `@weftui/core`/`@weftui/dom` project.

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weft form handling demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```typescript
// src/app.ts
/**
 * Login form: a validated email field with reactive Schema errors, and an
 * Effect-returning submit handler. Side-effect-free (no mount call), so
 * `main.ts` and any test can import `App` directly.
 */
import { h } from "@weftui/core";
import { Effect, Result, Schema, Stream, SubscriptionRef } from "effect";

const Email = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => (s.includes("@") ? undefined : "Must contain @"))),
  Schema.check(Schema.makeFilter((s) => (s.includes(".") ? undefined : "Must contain a domain"))),
);

export const App = () =>
  Effect.gen(function* () {
    const email = yield* SubscriptionRef.make("");
    const status = yield* SubscriptionRef.make<string | null>(null);

    const error = Stream.map(SubscriptionRef.changes(email), (value) => {
      if (value.length === 0) return null;
      return Result.match(Schema.decodeUnknownResult(Email)(value), {
        onFailure: (e) => e.message.split(":").pop()?.trim() ?? "Invalid",
        onSuccess: () => null,
      });
    });

    return yield* h.form(
      {
        onsubmit: (e) => {
          e.preventDefault();
          return Effect.gen(function* () {
            yield* SubscriptionRef.set(status, "Submitting…");
            yield* Effect.sleep("1500 millis");
            yield* SubscriptionRef.set(status, "Login successful!");
          });
        },
      },
      [
        h.input({
          type: "email",
          oninput: (e) => SubscriptionRef.set(email, e.currentTarget.value),
        }),
        Stream.map(error, (err) => (err ? h.span({ class: "error-text" }, err) : null)),
        h.button({ type: "submit" }, "Login"),
        h.div([Stream.map(SubscriptionRef.changes(status), (s) => (s ? h.span(s) : null))]),
      ],
    );
  });
```

```typescript
// src/main.ts
/**
 * Browser entry: mounts the form demo into #root.
 */
import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root")!;

const app = WeftApp.make();
void Effect.runPromise(WeftApp.mount(app, App(), root));
```

## See also

- [Reactive Primitives](../explanation/reactive-primitives.md): `SubscriptionRef.changes` and stream-shaped children
- [Author Components](./author-components.md): components with internal state and instance scope
- [examples/form-handling](../../examples/form-handling): a runnable multi-field form with Schema validation and an async submit
