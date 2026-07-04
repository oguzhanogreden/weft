import { Registry } from "@effect-atom/atom";
import { mountScoped } from "@weftui/dom/client";
import { Deferred, Effect, Fiber } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";

let container: HTMLElement;
let shutdown: Deferred.Deferred<void>;
let fiber: Fiber.RuntimeFiber<void, unknown> | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  // Signal the scoped region to close (unmount → Registry.layer release), then
  // await the fiber so the runtime is fully torn down before the next test.
  await Effect.runPromise(Deferred.succeed(shutdown, undefined));
  if (fiber) await Effect.runPromise(Fiber.join(fiber));
  fiber = undefined;
  container.remove();
});

// Mount via the recommended composition: `Registry.layer` (scoped) is provided
// OUTSIDE a long-lived scoped region, so it lives for the app's whole lifetime;
// `mountScoped` registers unmount on the region's scope; `runFork` drives it and
// `Deferred.await` keeps the region open until `afterEach` signals shutdown.
const mountApp = async () => {
  shutdown = await Effect.runPromise(Deferred.make<void>());
  fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* mountScoped(App(), container);
        yield* Deferred.await(shutdown);
      }),
    ).pipe(Effect.provide(Registry.layer)),
  );
};

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("effect-atom example", () => {
  it("renders the counter atom and its derived double", async () => {
    await mountApp();
    await vi.waitFor(() => {
      expect(byTestId("count")?.textContent).toBe("0");
      expect(byTestId("double")?.textContent).toBe("0");
    });
  });

  it("updates the counter and derived atom on click", async () => {
    await mountApp();
    await vi.waitFor(() => expect(byTestId("increment")).not.toBeNull());

    byTestId("increment")?.click();
    await vi.waitFor(() => {
      expect(byTestId("count")?.textContent).toBe("1");
      expect(byTestId("double")?.textContent).toBe("2");
    });

    byTestId("decrement")?.click();
    await vi.waitFor(() => {
      expect(byTestId("count")?.textContent).toBe("0");
      expect(byTestId("double")?.textContent).toBe("0");
    });
  });

  it("renders the async atom through its Result states", async () => {
    await mountApp();
    await vi.waitFor(() => expect(byTestId("greeting")?.textContent).toBe("Loading…"));
    await vi.waitFor(() =>
      expect(byTestId("greeting")?.textContent).toBe("Hello from effect-atom"),
    );
  });

  it("re-runs the async atom on refresh", async () => {
    await mountApp();
    await vi.waitFor(() =>
      expect(byTestId("greeting")?.textContent).toBe("Hello from effect-atom"),
    );

    byTestId("reload")?.click();
    await vi.waitFor(() => expect(byTestId("greeting")?.textContent).toBe("Reloading…"));
    await vi.waitFor(() =>
      expect(byTestId("greeting")?.textContent).toBe("Hello from effect-atom"),
    );
  });

  // Issue #123: the previously-broken composition now works. With the scoped
  // `Registry.layer` provided outside the region, the registry stays alive across
  // interactions (updates keep flowing); after shutdown the mount is unmounted and
  // post-shutdown clicks no longer patch the DOM.
  it("keeps the registry alive across interactions, then stops after shutdown", async () => {
    await mountApp();
    await vi.waitFor(() => expect(byTestId("count")?.textContent).toBe("0"));

    byTestId("increment")?.click();
    await vi.waitFor(() => expect(byTestId("count")?.textContent).toBe("1"));
    byTestId("increment")?.click();
    await vi.waitFor(() => expect(byTestId("count")?.textContent).toBe("2"));

    // Shut down: unmount runs at scope close, then the registry layer releases.
    await Effect.runPromise(Deferred.succeed(shutdown, undefined));
    await Effect.runPromise(Fiber.join(fiber!));

    // Nodes remain (unmount does not clear the root) but the handler is gone, so a
    // further click no longer updates the atom-driven DOM.
    const frozen = byTestId("count")?.textContent;
    expect(frozen).toBe("2");
    byTestId("increment")?.click();
    await wait(150);
    expect(byTestId("count")?.textContent).toBe(frozen);
  });
});
