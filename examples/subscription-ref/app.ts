/**
 * Recipe: SubscriptionRef
 *
 * This recipe demonstrates using Effect's SubscriptionRef as a reactive
 * state primitive, similar to signals in SolidJS or stores in Svelte.
 *
 * SubscriptionRef provides:
 * - A mutable reference that can be read and written
 * - A `.changes` stream that emits on every update
 * - Integration with Effect's ecosystem
 */

import { h } from "@weftui/core";
import { Effect, Either, Schema, Stream, SubscriptionRef } from "effect";

// ============================================================================
// Example 1: Basic Counter
// ============================================================================

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    const increment = () => SubscriptionRef.update(count, (n) => n + 1);
    const decrement = () => SubscriptionRef.update(count, (n) => n - 1);

    return yield* h.div([
      h.div({ class: "counter" }, [count.changes]),
      h.button({ type: "button", onclick: () => decrement() }, "-"),
      h.button({ type: "button", onclick: () => increment() }, "+"),
    ]);
  });

// ============================================================================
// Example 2: Derived State
// ============================================================================

const DerivedState = () =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);

    const doubled = Stream.map(count.changes, (n) => n * 2);
    const squared = Stream.map(count.changes, (n) => n * n);
    const isEven = Stream.map(count.changes, (n) => (n % 2 === 0 ? "Yes" : "No"));

    const increment = () => SubscriptionRef.update(count, (n) => n + 1);

    return yield* h.div([
      h.p(["Count: ", h.strong([count.changes])]),
      h.p(["Doubled: ", h.span({ class: "derived" }, [doubled])]),
      h.p(["Squared: ", h.span({ class: "derived" }, [squared])]),
      h.p(["Is Even: ", h.span({ class: "derived" }, [isEven])]),
      h.button({ type: "button", onclick: () => increment() }, "Increment"),
    ]);
  });

// ============================================================================
// Example 3: Object State with Schema Validation
// ============================================================================

const Name = Schema.String.pipe(
  Schema.filter((s) => s.length >= 2, { message: () => "Min 2 characters" }),
);

const Email = Schema.String.pipe(
  Schema.filter((s) => s.includes("@"), { message: () => "Must contain @" }),
  Schema.filter((s) => s.includes("."), { message: () => "Must have domain" }),
);

interface FormState {
  name: string;
  email: string;
  errors: { name: string | null; email: string | null };
}

const validate = <A, I>(schema: Schema.Schema<A, I>, value: I): string | null => {
  if (!value) return null;
  const result = Schema.decodeUnknownEither(schema)(value);
  return Either.match(result, {
    onLeft: (e) => e.message.split(":").pop()?.trim() ?? "Invalid",
    onRight: () => null,
  });
};

const ObjectState = () =>
  Effect.gen(function* () {
    const form = yield* SubscriptionRef.make<FormState>({
      name: "",
      email: "",
      errors: { name: null, email: null },
    });

    const updateName = (name: string) =>
      SubscriptionRef.update(form, (state) => ({
        ...state,
        name,
        errors: { ...state.errors, name: validate(Name, name) },
      }));

    const updateEmail = (email: string) =>
      SubscriptionRef.update(form, (state) => ({
        ...state,
        email,
        errors: { ...state.errors, email: validate(Email, email) },
      }));

    const isValid = Stream.map(
      form.changes,
      (s) => s.name.length > 0 && s.email.length > 0 && !s.errors.name && !s.errors.email,
    );

    return yield* h.div([
      h.div({ style: { marginBottom: "0.5rem" } }, [
        h.label("Name: "),
        h.input({
          type: "text",
          placeholder: "Min 2 characters",
          oninput: (e) => updateName((e.target as HTMLInputElement).value),
        }),
        Stream.map(form.changes, (s) =>
          s.errors.name
            ? h.span({ style: { color: "#c00", marginLeft: "0.5rem" } }, s.errors.name)
            : null,
        ),
      ]),
      h.div({ style: { marginBottom: "0.5rem" } }, [
        h.label("Email: "),
        h.input({
          type: "email",
          placeholder: "user@example.com",
          oninput: (e) => updateEmail((e.target as HTMLInputElement).value),
        }),
        Stream.map(form.changes, (s) =>
          s.errors.email
            ? h.span({ style: { color: "#c00", marginLeft: "0.5rem" } }, s.errors.email)
            : null,
        ),
      ]),
      h.div({ class: "preview" }, [
        Stream.map(form.changes, (s) =>
          s.name || s.email ? `Name: ${s.name}\nEmail: ${s.email}` : "(empty)",
        ),
      ]),
      h.p({ style: { marginTop: "0.5rem" } }, [
        "Valid: ",
        h.strong([Stream.map(isValid, (v) => (v ? "Yes" : "No"))]),
      ]),
    ]);
  });

// ============================================================================
// Example 4: Todo List
// ============================================================================

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

const TodoList = () =>
  Effect.gen(function* () {
    const todos = yield* SubscriptionRef.make<Todo[]>([
      { id: 1, text: "Learn Effect", done: true },
      { id: 2, text: "Build with Weft", done: false },
      { id: 3, text: "Ship to production", done: false },
    ]);

    const toggle = (id: number) =>
      SubscriptionRef.update(todos, (list) =>
        list.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)),
      );

    const completedCount = Stream.map(todos.changes, (list) => list.filter((t) => t.done).length);
    const totalCount = Stream.map(todos.changes, (list) => list.length);

    return yield* h.div([
      h.p(["Completed: ", h.span({ class: "derived" }, [completedCount]), " / ", totalCount]),
      h.ul({ style: { listStyle: "none", padding: 0 } }, [
        Stream.map(todos.changes, (list) =>
          list.map((todo) =>
            h.li(
              {
                style: {
                  padding: "0.5rem",
                  margin: "0.25rem 0",
                  background: todo.done ? "#e8f5e9" : "#fff",
                  borderRadius: "4px",
                  cursor: "pointer",
                  textDecoration: todo.done ? "line-through" : "none",
                },
                onclick: () => toggle(todo.id),
              },
              todo.text,
            ),
          ),
        ),
      ]),
    ]);
  });

// ============================================================================
// Example 5: Multiple Refs Coordination
// ============================================================================

const CoordinatedRefs = () =>
  Effect.gen(function* () {
    const firstName = yield* SubscriptionRef.make("");
    const lastName = yield* SubscriptionRef.make("");

    const fullName = Stream.zipLatestWith(firstName.changes, lastName.changes, (first, last) => {
      if (!first && !last) return "(empty)";
      return `${first} ${last}`.trim();
    });

    return yield* h.div([
      h.div({ style: { marginBottom: "0.5rem" } }, [
        h.input({
          type: "text",
          placeholder: "First name",
          oninput: (e) => SubscriptionRef.set(firstName, (e.target as HTMLInputElement).value),
        }),
      ]),
      h.div({ style: { marginBottom: "0.5rem" } }, [
        h.input({
          type: "text",
          placeholder: "Last name",
          oninput: (e) => SubscriptionRef.set(lastName, (e.target as HTMLInputElement).value),
        }),
      ]),
      h.p(["Full name: ", h.strong([fullName])]),
    ]);
  });

// ============================================================================
// App
// ============================================================================

export const App = () =>
  h.div([
    h.h1("SubscriptionRef"),

    h.section([
      h.h2("1. Basic Counter"),
      h.p("Simple counter with increment/decrement."),
      Counter(),
    ]),

    h.section([
      h.h2("2. Derived State"),
      h.p("Compute derived values from base state."),
      DerivedState(),
    ]),

    h.section([
      h.h2("3. Object State with Schema"),
      h.p("Form state with Schema validation."),
      ObjectState(),
    ]),

    h.section([h.h2("4. Todo List"), h.p("Array state with toggle functionality."), TodoList()]),

    h.section([
      h.h2("5. Coordinated Refs"),
      h.p("Combine multiple refs into derived state."),
      CoordinatedRefs(),
    ]),
  ]);
