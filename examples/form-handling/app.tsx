/**
 * Recipe: Form Handling
 *
 * This recipe demonstrates reactive form handling with stream-based inputs,
 * validation, and Effect-powered submit handlers.
 */

import { mount } from "@effect-ui/dom";
import { Effect, Either, Schema, Stream, SubscriptionRef } from "effect";

// ============================================================================
// Example 1: Basic Reactive Input
// ============================================================================

const BasicInput = () =>
  Effect.gen(function* () {
    const value = yield* SubscriptionRef.make("");

    return (
      <div>
        <input
          type="text"
          placeholder="Type something..."
          oninput={(e) => SubscriptionRef.set(value, e.currentTarget.value)}
        />
        <div class="preview">You typed: {value.changes}</div>
      </div>
    );
  });

// ============================================================================
// Example 2: Schema Validation
// ============================================================================

// Define a Schema for email validation
const Email = Schema.String.pipe(
  Schema.filter((s) => s.length > 0, { message: () => "Email is required" }),
  Schema.filter((s) => s.includes("@"), { message: () => "Must contain @" }),
  Schema.filter((s) => s.includes("."), {
    message: () => "Must contain a domain",
  }),
);

const SchemaEmailInput = () =>
  Effect.gen(function* () {
    const email = yield* SubscriptionRef.make("");

    // Validate using Schema.decodeUnknownEither
    const validationStream = Stream.map(email.changes, (value) => {
      if (value.length === 0) return { valid: false, error: null };
      const result = Schema.decodeUnknownEither(Email)(value);
      return Either.match(result, {
        onLeft: (e) => ({
          valid: false,
          error: e.message.split(":").pop()?.trim() ?? "Invalid",
        }),
        onRight: () => ({ valid: true, error: null }),
      });
    });

    return (
      <div class="form-group">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
        <label>Email (Schema validated)</label>
        <input
          type="email"
          placeholder="user@example.com"
          oninput={(e) => SubscriptionRef.set(email, (e.target as HTMLInputElement).value)}
        />
        <div>
          {Stream.map(validationStream, ({ valid, error }) =>
            error ? (
              <span class="error-text">{error}</span>
            ) : valid ? (
              <span class="success-text">Valid email</span>
            ) : null,
          )}
        </div>
      </div>
    );
  });

// ============================================================================
// Example 3: Character Counter
// ============================================================================

const CharacterCounter = () =>
  Effect.gen(function* () {
    const text = yield* SubscriptionRef.make("");
    const maxLength = 100;

    const countStream = Stream.map(text.changes, (t) => t.length);
    const remainingStream = Stream.map(countStream, (count) => maxLength - count);

    return (
      <div class="form-group">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
        <label>Bio (max {maxLength} chars)</label>
        <textarea
          placeholder="Tell us about yourself..."
          oninput={(e) => SubscriptionRef.set(text, (e.target as HTMLTextAreaElement).value)}
        />
        <div class="preview">
          {Stream.map(remainingStream, (remaining) => (
            <span style={{ color: remaining < 20 ? "#f44336" : "#666" }}>
              {remaining} characters remaining
            </span>
          ))}
        </div>
      </div>
    );
  });

// ============================================================================
// Example 4: Form Submit with Effect
// ============================================================================

const LoginForm = () =>
  Effect.gen(function* () {
    const status = yield* SubscriptionRef.make<string | null>(null);

    return (
      <form
        onsubmit={(e) => {
          e.preventDefault();
          return Effect.gen(function* () {
            yield* SubscriptionRef.set(status, "Submitting...");
            yield* Effect.log("Form submitted");
            yield* Effect.sleep("1500 millis");
            yield* SubscriptionRef.set(status, "Login successful!");
            yield* Effect.log("Login complete");
          });
        }}
      >
        <div class="form-group">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
          <label>Username</label>
          <input type="text" placeholder="Enter username" />
        </div>
        <div class="form-group">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
          <label>Password</label>
          <input type="password" placeholder="Enter password" />
        </div>
        <button type="submit">Login</button>
        <div class="preview">
          {Stream.map(status.changes, (s) => (s ? <span>{s}</span> : null))}
        </div>
      </form>
    );
  });

// ============================================================================
// Example 5: Complete Form with Schema Validation
// ============================================================================

// Define schemas for each field
const Username = Schema.String.pipe(
  Schema.filter((s) => s.length >= 3, {
    message: () => "Min 3 characters",
  }),
  Schema.filter((s) => /^[a-zA-Z0-9_]+$/.test(s), {
    message: () => "Only letters, numbers, underscore",
  }),
);

const Password = Schema.String.pipe(
  Schema.filter((s) => s.length >= 8, {
    message: () => "Min 8 characters",
  }),
  Schema.filter((s) => /[A-Z]/.test(s), {
    message: () => "Must contain uppercase",
  }),
  Schema.filter((s) => /[0-9]/.test(s), {
    message: () => "Must contain number",
  }),
);

const Age = Schema.String.pipe(
  Schema.filter((s) => /^\d+$/.test(s), {
    message: () => "Must be a number",
  }),
  Schema.transform(Schema.Number, {
    decode: (s) => Number.parseInt(s, 10),
    encode: (n) => String(n),
  }),
  Schema.filter((n) => n >= 18, { message: () => "Must be 18 or older" }),
  Schema.filter((n) => n <= 120, { message: () => "Invalid age" }),
);

// Helper to validate a field
const validateField = <A, I>(schema: Schema.Schema<A, I>, value: I) => {
  const result = Schema.decodeUnknownEither(schema)(value);
  return Either.match(result, {
    onLeft: (e) => e.message.split(":").pop()?.trim() ?? "Invalid",
    onRight: () => null,
  });
};

const SchemaForm = () =>
  Effect.gen(function* () {
    const usernameRef = yield* SubscriptionRef.make("");
    const passwordRef = yield* SubscriptionRef.make("");
    const ageRef = yield* SubscriptionRef.make("");
    const statusRef = yield* SubscriptionRef.make<string | null>(null);

    const usernameError = Stream.map(usernameRef.changes, (v) =>
      v ? validateField(Username, v) : null,
    );
    const passwordError = Stream.map(passwordRef.changes, (v) =>
      v ? validateField(Password, v) : null,
    );
    const ageError = Stream.map(ageRef.changes, (v) => (v ? validateField(Age, v) : null));

    // Check if form is valid (all fields filled and no errors)
    const isValid = Stream.zipLatestWith(
      Stream.zipLatestWith(usernameRef.changes, passwordRef.changes, (u, p) => ({ u, p })),
      ageRef.changes,
      ({ u, p }, a) =>
        u.length > 0 &&
        p.length > 0 &&
        a.length > 0 &&
        !validateField(Username, u) &&
        !validateField(Password, p) &&
        !validateField(Age, a),
    );

    return (
      <form
        onsubmit={(e) => {
          e.preventDefault();
          return Effect.gen(function* () {
            yield* SubscriptionRef.set(statusRef, "Validating...");
            yield* Effect.sleep("500 millis");

            // Read current values
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
        }}
      >
        <div class="form-group">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
          <label>Username</label>
          <input
            type="text"
            placeholder="min 3 chars, alphanumeric"
            oninput={(e) => SubscriptionRef.set(usernameRef, (e.target as HTMLInputElement).value)}
          />
          {Stream.map(usernameError, (err) => (err ? <span class="error-text">{err}</span> : null))}
        </div>
        <div class="form-group">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
          <label>Password</label>
          <input
            type="password"
            placeholder="min 8 chars, uppercase + number"
            oninput={(e) => SubscriptionRef.set(passwordRef, (e.target as HTMLInputElement).value)}
          />
          {Stream.map(passwordError, (err) => (err ? <span class="error-text">{err}</span> : null))}
        </div>
        <div class="form-group">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
          <label>Age</label>
          <input
            type="text"
            placeholder="18+"
            oninput={(e) => SubscriptionRef.set(ageRef, (e.target as HTMLInputElement).value)}
          />
          {Stream.map(ageError, (err) => (err ? <span class="error-text">{err}</span> : null))}
        </div>
        <button type="submit">
          {Stream.map(isValid, (valid) => (valid ? "Register" : "Fill all fields"))}
        </button>
        <div class="preview">
          {Stream.map(statusRef.changes, (s) => (s ? <span>{s}</span> : null))}
        </div>
      </form>
    );
  });

// ============================================================================
// Example 6: Live Search Preview
// ============================================================================

const SearchPreview = () =>
  Effect.gen(function* () {
    const query = yield* SubscriptionRef.make("");

    // Simulated search results
    const resultsStream = Stream.map(query.changes, (q) => {
      if (q.length < 2) return [];
      const items = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];
      return items.filter((item) => item.toLowerCase().includes(q.toLowerCase()));
    });

    return (
      <div>
        <input
          type="search"
          placeholder="Search fruits..."
          oninput={(e) => SubscriptionRef.set(query, (e.target as HTMLInputElement).value)}
        />
        <div class="preview">
          {Stream.map(resultsStream, (results) =>
            results.length > 0 ? (
              <ul>
                {results.map((item) => (
                  <li>{item}</li>
                ))}
              </ul>
            ) : (
              <span>Type at least 2 characters to search</span>
            ),
          )}
        </div>
      </div>
    );
  });

// ============================================================================
// App
// ============================================================================

const App = () => (
  <div>
    <h1>Form Handling</h1>

    <section>
      <h2>1. Basic Reactive Input</h2>
      <BasicInput />
    </section>

    <section>
      <h2>2. Schema Validation</h2>
      <SchemaEmailInput />
    </section>

    <section>
      <h2>3. Character Counter</h2>
      <CharacterCounter />
    </section>

    <section>
      <h2>4. Form Submit with Effect</h2>
      <LoginForm />
    </section>

    <section>
      <h2>5. Complete Schema Form</h2>
      <SchemaForm />
    </section>

    <section>
      <h2>6. Live Search Preview</h2>
      <SearchPreview />
    </section>
  </div>
);

void Effect.runPromise(mount(<App />, document.getElementById("root")!));
