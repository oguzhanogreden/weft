import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Context, Deferred, Effect, Fiber, Layer, Stream, SubscriptionRef } from "effect";
import { h } from "@weftui/core";
// Import the built package (like the example browser tests) rather than the
// source module: the flat browser vitest config does not resolve the package's
// `~/*` path aliases that `render.ts` relies on.
import { mountScoped } from "@weftui/dom/client";

// ============================================================================
// Issue #123 acceptance criterion, in a real browser.
//
// A hand-rolled `Layer.scoped` service (no @effect-atom dependency) stands in for
// any scoped layer (e.g. effect-atom's `Registry.layer`). Provided OUTSIDE a
// long-lived scoped region driven by `runFork`, it must:
//   - be acquired once and stay alive across real click interactions
//     (its `release` finalizer does NOT run at mount-resolve), and
//   - be released only when the region ends, after the mount is unmounted, so
//     post-shutdown emissions no longer patch the DOM.
// ============================================================================

interface CounterService {
  readonly value: SubscriptionRef.SubscriptionRef<number>;
  readonly increment: Effect.Effect<void>;
}

class Counter extends Context.Tag("test/mount-scoped-e2e/Counter")<Counter, CounterService>() {}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  container.remove();
});

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mountScoped — scoped layer outlives initial render (issue #123)", () => {
  it("keeps the scoped service alive across clicks; releases only at scope close", async () => {
    const log: string[] = [];
    // Captured during acquire so the test can emit after shutdown and prove the
    // subscription was interrupted by unmount.
    let capturedRef: SubscriptionRef.SubscriptionRef<number> | undefined;

    const CounterLive = Layer.scoped(
      Counter,
      Effect.acquireRelease(
        Effect.gen(function* () {
          log.push("acquire");
          const value = yield* SubscriptionRef.make(0);
          capturedRef = value;
          return {
            value,
            increment: SubscriptionRef.update(value, (n) => n + 1),
          } satisfies CounterService;
        }),
        () => Effect.sync(() => void log.push("release")),
      ),
    );

    const App = () =>
      h.div([
        // Reactive region reads the scoped service via the mount runtime.
        Effect.gen(function* () {
          const counter = yield* Counter;
          return h.strong({ "data-testid": "count" }, [Stream.map(counter.value.changes, String)]);
        }),
        h.button(
          {
            type: "button",
            "data-testid": "inc",
            onclick: () => Effect.flatMap(Counter, (c) => c.increment),
          },
          "+",
        ),
      ]);

    const shutdown = await Effect.runPromise(Deferred.make<void>());

    // runFork, NOT runPromise: the region blocks on `Deferred.await` forever.
    // The scoped layer is provided OUTSIDE the region so it lives for the app's
    // whole lifetime, released only when the region ends.
    const fiber = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mountScoped(App(), container);
          yield* Deferred.await(shutdown);
        }),
      ).pipe(Effect.provide(CounterLive)),
    );

    // Initial render (post-mount tick).
    await vi.waitFor(() => expect(byTestId("count")?.textContent).toBe("0"));

    // Real click reaches the handler; the service-derived value re-renders.
    byTestId("inc")?.click();
    await vi.waitFor(() => expect(byTestId("count")?.textContent).toBe("1"));
    byTestId("inc")?.click();
    await vi.waitFor(() => expect(byTestId("count")?.textContent).toBe("2"));

    // Acquired once; the finalizer did NOT run at mount-resolve.
    expect(log).toEqual(["acquire"]);

    // Shut down: signal the region, await the fiber. Teardown order is
    // unmount (inner scope close) → CounterLive release.
    await Effect.runPromise(Deferred.succeed(shutdown, undefined));
    await Effect.runPromise(Fiber.join(fiber));
    expect(log).toEqual(["acquire", "release"]);

    // Post-shutdown emissions no longer patch the DOM (subscription interrupted
    // by unmount). Nodes remain (unmount does not clear the root).
    const frozen = byTestId("count")?.textContent;
    expect(frozen).toBe("2");
    await Effect.runPromise(SubscriptionRef.set(capturedRef!, 999));
    await wait(150);
    expect(byTestId("count")?.textContent).toBe(frozen);
  });
});
