/**
 * Recipe: Async Data Loading
 *
 * This recipe demonstrates how to build components that fetch data asynchronously
 * using Effect, with built-in loading states and error handling.
 */

import { h } from "@weftui/core";
import { Effect, Stream } from "effect";

// ============================================================================
// Example 1: Loading State with Stream.concat
// ============================================================================

const LoadingThenData = () =>
  Stream.concat(
    Stream.make(h.span({ class: "loading" }, "Loading...")),
    Stream.fromEffect(
      Effect.gen(function* () {
        yield* Effect.sleep("1500 millis");
        return yield* h.span({ class: "data" }, "Data loaded successfully!");
      }),
    ),
  );

// ============================================================================
// Example 2: Simulated API Fetch with Error Handling
// ============================================================================

interface User {
  id: number;
  name: string;
  email: string;
}

const fetchUser = (id: number): Effect.Effect<User, Error> =>
  Effect.gen(function* () {
    yield* Effect.sleep("1000 millis");

    if (id === 3) {
      return yield* Effect.fail(new Error("User not found"));
    }

    return {
      id,
      name: `User ${id}`,
      email: `user${id}@example.com`,
    };
  });

const UserCard = ({ id }: { id: number }) =>
  Stream.concat(
    Stream.make(h.div({ class: "loading" }, `Loading user ${id}...`)),
    Stream.fromEffect(
      fetchUser(id).pipe(
        Effect.flatMap((user) => h.div({ class: "user-card" }, [h.h3(user.name), h.p(user.email)])),
        Effect.catchAll((error) =>
          h.div({ class: "error" }, `Error loading user ${id}: ${error.message}`),
        ),
      ),
    ),
  );

// ============================================================================
// Example 3: Effect-Returning Component (Direct)
// ============================================================================

const DelayedGreeting = ({ name }: { name: string }) =>
  Effect.gen(function* () {
    yield* Effect.sleep("800 millis");
    return yield* h.span({ class: "data" }, `Hello, ${name}!`);
  });

// ============================================================================
// Example 4: Parallel Loading
// ============================================================================

const Dashboard = () =>
  h.div({ style: { display: "flex", gap: "1rem", flexWrap: "wrap" } }, [
    UserCard({ id: 1 }),
    UserCard({ id: 2 }),
    UserCard({ id: 3 }),
  ]);

// ============================================================================
// Example 5: Sequential Loading with Dependencies
// ============================================================================

const SequentialLoad = () =>
  Stream.make(h.span({ class: "loading" }, "Step 1: Initializing...")).pipe(
    Stream.concat(
      Stream.fromEffect(
        Effect.gen(function* () {
          yield* Effect.sleep("1000 millis");
          return yield* h.span({ class: "loading" }, "Step 2: Fetching data...");
        }),
      ),
    ),
    Stream.concat(
      Stream.fromEffect(
        Effect.gen(function* () {
          yield* Effect.sleep("1000 millis");
          return yield* h.span({ class: "loading" }, "Step 3: Processing...");
        }),
      ),
    ),
    Stream.concat(
      Stream.fromEffect(
        Effect.gen(function* () {
          yield* Effect.sleep("1000 millis");
          return yield* h.span({ class: "data" }, "Complete!");
        }),
      ),
    ),
  );

// ============================================================================
// App
// ============================================================================

export const App = () =>
  h.div([
    h.h1("Async Data Loading"),

    h.section([
      h.h2("1. Loading State Pattern"),
      h.p("Shows loading, then data after delay."),
      h.div({ style: { marginTop: "0.5rem" } }, [LoadingThenData()]),
    ]),

    h.section([
      h.h2("2. Effect Component (Direct)"),
      h.p("Component returns Effect directly."),
      h.div({ style: { marginTop: "0.5rem" } }, [DelayedGreeting({ name: "World" })]),
    ]),

    h.section([
      h.h2("3. Parallel Loading with Error Handling"),
      h.p("Multiple users load in parallel. User 3 will fail."),
      h.div({ style: { marginTop: "0.5rem" } }, [Dashboard()]),
    ]),

    h.section([
      h.h2("4. Sequential Loading Steps"),
      h.p("Multi-step process with status updates."),
      h.div({ style: { marginTop: "0.5rem" } }, [SequentialLoad()]),
    ]),
  ]);
