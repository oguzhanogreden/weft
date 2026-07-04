import { Registry } from "@effect-atom/atom";
import { mount, type MountHandle } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";

let container: HTMLElement;
let handle: MountHandle;
let registry: Registry.Registry;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await Effect.runPromise(handle.unmount());
  registry.dispose();
  container.remove();
});

// A fresh registry per test isolates atom state; it must outlive the mount
// effect (Registry.layer is scoped and would dispose it on mount completion),
// so it is provided as a plain service value and disposed in afterEach.
const mountApp = async () => {
  registry = Registry.make();
  handle = await Effect.runPromise(
    mount(App(), container).pipe(Effect.provideService(Registry.AtomRegistry, registry)),
  );
};

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

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
});
