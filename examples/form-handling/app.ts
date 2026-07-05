/**
 * Recipe: Form Handling
 *
 * This recipe demonstrates reactive form handling with stream-based inputs,
 * validation, and Effect-powered submit handlers.
 */

import { h } from "@weftui/core";
import { Effect, Result, Schema, Stream, SubscriptionRef } from "effect";

// ============================================================================
// Example 1: Basic Reactive Input
// ============================================================================

const BasicInput = () =>
  Effect.gen(function* () {
    const value = yield* SubscriptionRef.make("");

    return yield* h.div([
      h.input({
        type: "text",
        placeholder: "Type something...",
        oninput: (e) => SubscriptionRef.set(value, e.currentTarget.value),
      }),
      h.div({ class: "preview" }, ["You typed: ", SubscriptionRef.changes(value)]),
    ]);
  });

// ============================================================================
// Example 2: Schema Validation
// ============================================================================

const Email = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => (s.length > 0 ? undefined : "Email is required"))),
  Schema.check(Schema.makeFilter((s) => (s.includes("@") ? undefined : "Must contain @"))),
  Schema.check(Schema.makeFilter((s) => (s.includes(".") ? undefined : "Must contain a domain"))),
);

const SchemaEmailInput = () =>
  Effect.gen(function* () {
    const email = yield* SubscriptionRef.make("");

    const validationStream = Stream.map(SubscriptionRef.changes(email), (value) => {
      if (value.length === 0) return { valid: false, error: null };
      const result = Schema.decodeUnknownResult(Email)(value);
      return Result.match(result, {
        onFailure: (e) => ({
          valid: false,
          error: e.message.split(":").pop()?.trim() ?? "Invalid",
        }),
        onSuccess: () => ({ valid: true, error: null }),
      });
    });

    return yield* h.div({ class: "form-group" }, [
      h.label("Email (Schema validated)"),
      h.input({
        type: "email",
        placeholder: "user@example.com",
        oninput: (e) => SubscriptionRef.set(email, (e.target as HTMLInputElement).value),
      }),
      h.div([
        Stream.map(validationStream, ({ valid, error }) =>
          error
            ? h.span({ class: "error-text" }, error)
            : valid
              ? h.span({ class: "success-text" }, "Valid email")
              : null,
        ),
      ]),
    ]);
  });

// ============================================================================
// Example 3: Character Counter
// ============================================================================

const CharacterCounter = () =>
  Effect.gen(function* () {
    const text = yield* SubscriptionRef.make("");
    const maxLength = 100;

    const countStream = Stream.map(SubscriptionRef.changes(text), (t) => t.length);
    const remainingStream = Stream.map(countStream, (count) => maxLength - count);

    return yield* h.div({ class: "form-group" }, [
      h.label(`Bio (max ${maxLength} chars)`),
      h.textarea({
        placeholder: "Tell us about yourself...",
        oninput: (e) => SubscriptionRef.set(text, (e.target as HTMLTextAreaElement).value),
      }),
      h.div({ class: "preview" }, [
        Stream.map(remainingStream, (remaining) =>
          h.span(
            { style: { color: remaining < 20 ? "#f44336" : "#666" } },
            `${remaining} characters remaining`,
          ),
        ),
      ]),
    ]);
  });

// ============================================================================
// Example 4: Form Submit with Effect
// ============================================================================

const LoginForm = () =>
  Effect.gen(function* () {
    const status = yield* SubscriptionRef.make<string | null>(null);

    return yield* h.form(
      {
        onsubmit: (e) => {
          e.preventDefault();
          return Effect.gen(function* () {
            yield* SubscriptionRef.set(status, "Submitting...");
            yield* Effect.log("Form submitted");
            yield* Effect.sleep("1500 millis");
            yield* SubscriptionRef.set(status, "Login successful!");
            yield* Effect.log("Login complete");
          });
        },
      },
      [
        h.div({ class: "form-group" }, [
          h.label("Username"),
          h.input({ type: "text", placeholder: "Enter username" }),
        ]),
        h.div({ class: "form-group" }, [
          h.label("Password"),
          h.input({ type: "password", placeholder: "Enter password" }),
        ]),
        h.button({ type: "submit" }, "Login"),
        h.div({ class: "preview" }, [
          Stream.map(SubscriptionRef.changes(status), (s) => (s ? h.span(s) : null)),
        ]),
      ],
    );
  });

// ============================================================================
// Example 5: Complete Form with Schema Validation
// ============================================================================

const Username = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => (s.length >= 3 ? undefined : "Min 3 characters"))),
  Schema.check(
    Schema.makeFilter((s) =>
      /^[a-zA-Z0-9_]+$/.test(s) ? undefined : "Only letters, numbers, underscore",
    ),
  ),
);

const Password = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => (s.length >= 8 ? undefined : "Min 8 characters"))),
  Schema.check(Schema.makeFilter((s) => (/[A-Z]/.test(s) ? undefined : "Must contain uppercase"))),
  Schema.check(Schema.makeFilter((s) => (/[0-9]/.test(s) ? undefined : "Must contain number"))),
);

// `NumberFromString` decodes the string input to a number (failing on a
// non-numeric value), replacing v3's explicit digit-check + `Schema.transform`.
const Age = Schema.NumberFromString.pipe(
  Schema.check(Schema.makeFilter((n) => (n >= 18 ? undefined : "Must be 18 or older"))),
  Schema.check(Schema.makeFilter((n) => (n <= 120 ? undefined : "Invalid age"))),
);

const validateField = <A, I>(schema: Schema.Codec<A, I>, value: I) => {
  const result = Schema.decodeUnknownResult(schema)(value);
  return Result.match(result, {
    onFailure: (e) => e.message.split(":").pop()?.trim() ?? "Invalid",
    onSuccess: () => null,
  });
};

const SchemaForm = () =>
  Effect.gen(function* () {
    const usernameRef = yield* SubscriptionRef.make("");
    const passwordRef = yield* SubscriptionRef.make("");
    const ageRef = yield* SubscriptionRef.make("");
    const statusRef = yield* SubscriptionRef.make<string | null>(null);

    const usernameError = Stream.map(SubscriptionRef.changes(usernameRef), (v) =>
      v ? validateField(Username, v) : null,
    );
    const passwordError = Stream.map(SubscriptionRef.changes(passwordRef), (v) =>
      v ? validateField(Password, v) : null,
    );
    const ageError = Stream.map(SubscriptionRef.changes(ageRef), (v) =>
      v ? validateField(Age, v) : null,
    );

    const isValid = Stream.zipLatestWith(
      Stream.zipLatestWith(
        SubscriptionRef.changes(usernameRef),
        SubscriptionRef.changes(passwordRef),
        (u, p) => ({ u, p }),
      ),
      SubscriptionRef.changes(ageRef),
      ({ u, p }, a) =>
        u.length > 0 &&
        p.length > 0 &&
        a.length > 0 &&
        !validateField(Username, u) &&
        !validateField(Password, p) &&
        !validateField(Age, a),
    );

    return yield* h.form(
      {
        onsubmit: (e) => {
          e.preventDefault();
          return Effect.gen(function* () {
            yield* SubscriptionRef.set(statusRef, "Validating...");
            yield* Effect.sleep("500 millis");

            const u = yield* SubscriptionRef.get(usernameRef);
            const p = yield* SubscriptionRef.get(passwordRef);
            const a = yield* SubscriptionRef.get(ageRef);

            const errors = [
              validateField(Username, u),
              validateField(Password, p),
              validateField(Age, a),
            ].filter(Boolean);

            yield* SubscriptionRef.set(
              statusRef,
              errors.length > 0 || !u || !p || !a
                ? "Please fix validation errors"
                : "Registration successful!",
            );
          });
        },
      },
      [
        h.div({ class: "form-group" }, [
          h.label("Username"),
          h.input({
            type: "text",
            placeholder: "min 3 chars, alphanumeric",
            oninput: (e) => SubscriptionRef.set(usernameRef, (e.target as HTMLInputElement).value),
          }),
          Stream.map(usernameError, (err) => (err ? h.span({ class: "error-text" }, err) : null)),
        ]),
        h.div({ class: "form-group" }, [
          h.label("Password"),
          h.input({
            type: "password",
            placeholder: "min 8 chars, uppercase + number",
            oninput: (e) => SubscriptionRef.set(passwordRef, (e.target as HTMLInputElement).value),
          }),
          Stream.map(passwordError, (err) => (err ? h.span({ class: "error-text" }, err) : null)),
        ]),
        h.div({ class: "form-group" }, [
          h.label("Age"),
          h.input({
            type: "text",
            placeholder: "18+",
            oninput: (e) => SubscriptionRef.set(ageRef, (e.target as HTMLInputElement).value),
          }),
          Stream.map(ageError, (err) => (err ? h.span({ class: "error-text" }, err) : null)),
        ]),
        h.button({ type: "submit" }, [
          Stream.map(isValid, (valid) => (valid ? "Register" : "Fill all fields")),
        ]),
        h.div({ class: "preview" }, [
          Stream.map(SubscriptionRef.changes(statusRef), (s) => (s ? h.span(s) : null)),
        ]),
      ],
    );
  });

// ============================================================================
// Example 6: Live Search Preview
// ============================================================================

const SearchPreview = () =>
  Effect.gen(function* () {
    const query = yield* SubscriptionRef.make("");

    const resultsStream = Stream.map(SubscriptionRef.changes(query), (q) => {
      if (q.length < 2) return [];
      const items = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];
      return items.filter((item) => item.toLowerCase().includes(q.toLowerCase()));
    });

    return yield* h.div([
      h.input({
        type: "search",
        placeholder: "Search fruits...",
        oninput: (e) => SubscriptionRef.set(query, (e.target as HTMLInputElement).value),
      }),
      h.div({ class: "preview" }, [
        Stream.map(resultsStream, (results) =>
          results.length > 0
            ? h.ul(results.map((item) => h.li(item)))
            : h.span("Type at least 2 characters to search"),
        ),
      ]),
    ]);
  });

// ============================================================================
// App
// ============================================================================

export const App = () =>
  h.div([
    h.h1("Form Handling"),

    h.section([h.h2("1. Basic Reactive Input"), BasicInput()]),

    h.section([h.h2("2. Schema Validation"), SchemaEmailInput()]),

    h.section([h.h2("3. Character Counter"), CharacterCounter()]),

    h.section([h.h2("4. Form Submit with Effect"), LoginForm()]),

    h.section([h.h2("5. Complete Schema Form"), SchemaForm()]),

    h.section([h.h2("6. Live Search Preview"), SearchPreview()]),
  ]);
