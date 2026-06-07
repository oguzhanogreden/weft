/**
 * End-to-end browser test for `Boundary.server` **client refetch** over the
 * router's data endpoint — the one integration the jsdom unit tests stub out: the
 * real `HttpApiClient ↔ webHandler` network hop.
 *
 * It renders `/dashboard` to hydratable HTML exactly as the server does (running
 * the server-only `Metrics` `load`), installs that markup in `#root`, and
 * `hydrate`s `RouterApp(App)` over it. A `window.fetch` shim delegates the
 * same-origin `GET /_eui/data` request the derived `HttpApiClient` issues to the
 * router's own `RouterServer.toWebHandler` — so clicking "Refresh" performs a
 * faithful round-trip: client → endpoint → server `load` → encoded envelope →
 * client decode → in-place patch.
 *
 * Asserts the headline guarantees:
 *   (a) first paint shows the SSR metric (no flash — the `#metric` node is adopted
 *       in place across hydration), and
 *   (b) clicking "Refresh" hits `/_eui/data?id=dashboard-metrics`, re-runs `load`
 *       on the server (a strictly larger value), and patches the region in place
 *       (same `.dashboard` / `#metric` node — no remount), with `pending` settling
 *       back to "no".
 */

import { hydrate, type MountHandle } from "@effect-ui/dom/client";
import { Router, RouterApp, RouterLive } from "@effect-ui/router/client";
import { RouterServer } from "@effect-ui/router/server";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { documentShell } from "./entry-server";

let container: HTMLElement;
let handle: MountHandle;
let runtime: ManagedRuntime.ManagedRuntime<Router, never>;
let originalFetch: typeof globalThis.fetch;

/** The router's own platform web handler — answers the same-origin `/_eui/data` hop. */
const serverHandler = RouterServer.toWebHandler(App, { document: documentShell });

beforeEach(() => {
  container = document.createElement("div");
  container.id = "root";
  document.body.append(container);

  // Delegate the derived HttpApiClient's same-origin `GET /_eui/data` fetch to the
  // router's web handler; let every other request fall through to the real fetch.
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    if (new URL(url, window.location.origin).pathname === "/_eui/data") {
      return serverHandler(input instanceof Request ? input : new Request(url, init));
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (handle !== undefined) await Effect.runPromise(handle.unmount());
  if (runtime !== undefined) await runtime.dispose();
  container.remove();
  window.history.replaceState(null, "", "/");
});

/** Renders `url` to a full document and parses it back into a DOM `Document`. */
const ssrDocument = async (url: string): Promise<Document> => {
  const { html } = await Effect.runPromise(
    RouterServer.render(App, { document: documentShell, url }),
  );
  return new DOMParser().parseFromString(html, "text/html");
};

/** SSR `url`, install the `#root` subtree as static markup, and hydrate over it. */
const ssrAndHydrate = async (url: string): Promise<void> => {
  const root = (await ssrDocument(url)).getElementById("root");
  container.innerHTML = root?.innerHTML ?? "";

  window.history.replaceState(null, "", url);
  // RouterLive is scoped (owns popstate + link interceptor); a ManagedRuntime keeps
  // it alive, and also provides the BoundaryDataClient transport that backs refetch.
  runtime = ManagedRuntime.make(RouterLive(App));
  handle = await runtime.runPromise(hydrate(RouterApp(App), container));
};

describe("router-ssr example — Boundary.server client refetch", () => {
  it("shows the SSR metric, refetches over /_eui/data, and patches in place", async () => {
    // First paint: the SSR metric is present in the static markup (before any client JS).
    const metricInSsr = (await ssrDocument("/dashboard")).getElementById("metric")?.textContent;
    expect(metricInSsr).toMatch(/^\d+$/);

    await ssrAndHydrate("/dashboard");

    // (a) No flash: the #metric node is adopted in place and reads a number.
    const metricEl = container.querySelector("#metric");
    const dashboardEl = container.querySelector(".dashboard");
    expect(metricEl).not.toBeNull();
    expect(dashboardEl).not.toBeNull();
    expect(metricEl?.textContent).toMatch(/^\d+$/);

    const valueBefore = Number(metricEl?.textContent);

    // (b) Click Refresh → derived HttpApiClient hits /_eui/data → server re-runs
    //     `load` (strictly larger value) → region patches in place. `hydrate`'s
    //     interactivity barrier (hydrate-ready.specs.md) guarantees the outlet's
    //     reactive region — and so the button's click listener — is live the moment
    //     `hydrate` resolves, so a single dispatch suffices; only the async refetch
    //     result is polled.
    const refresh = container.querySelector<HTMLButtonElement>("#refresh");
    expect(refresh).not.toBeNull();

    refresh!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(Number(metricEl?.textContent)).toBeGreaterThan(valueBefore);
    });

    // Same nodes — no remount, no flash; pending settles back to "no".
    expect(container.querySelector("#metric")).toBe(metricEl);
    expect(container.querySelector(".dashboard")).toBe(dashboardEl);
    await vi.waitFor(() => expect(container.querySelector("#pending")?.textContent).toBe("no"));
  });
});
