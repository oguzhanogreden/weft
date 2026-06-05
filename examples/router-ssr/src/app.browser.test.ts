/**
 * End-to-end browser test for the router-ssr example.
 *
 * Mounts `RouterApp(App)` with the History-API `Router` in a real browser, drives
 * SPA navigation via a plain `h.a` link click, and asserts the headline
 * behaviour: the inner outlet swaps (`Settings` → `Posts`) while the surrounding
 * `/users/:id` layout **persists** — same DOM node, and its counter keeps its
 * value. A second case asserts the not-found page renders for an unmatched URL.
 */

import { Component, h } from "@effect-ui/core";
import { mount, type MountHandle } from "@effect-ui/dom/client";
import { notFound, type RouterDef } from "@effect-ui/router";
import { Router, RouterApp, RouterLive } from "@effect-ui/router/client";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";

let container: HTMLElement;
let handle: MountHandle;
let runtime: ManagedRuntime.ManagedRuntime<Router, never>;

beforeEach(() => {
  container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
});

afterEach(async () => {
  if (handle !== undefined) await Effect.runPromise(handle.unmount());
  if (runtime !== undefined) await runtime.dispose();
  container.remove();
  window.history.replaceState(null, "", "/");
});

const mountAt = async (path: string, def: RouterDef = App): Promise<void> => {
  window.history.replaceState(null, "", path);
  // RouterLive is scoped; a ManagedRuntime keeps it (and the link interceptor)
  // alive for the test, while mount captures the Router service from it.
  runtime = ManagedRuntime.make(RouterLive(def));
  handle = await runtime.runPromise(mount(RouterApp(def), container));
};

describe("router-ssr example", () => {
  it("navigates between sibling pages while persisting the layout", async () => {
    await mountAt("/users/1/settings");

    // Initial route: the /users/:id layout + the settings leaf.
    await vi.waitFor(() => expect(container.textContent).toContain("Settings page"));
    expect(container.textContent).toContain("User 1");

    const layoutEl = container.querySelector("[data-user-layout]");
    expect(layoutEl).not.toBeNull();

    // Mutate layout-owned state so persistence is observable.
    const bump = container.querySelector<HTMLButtonElement>("#bump");
    bump!.click();
    await vi.waitFor(() => expect(container.querySelector("#count")?.textContent).toBe("1"));

    // Click the plain <a> Posts link → SPA navigation (no full load).
    const posts = [...container.querySelectorAll("a")].find((a) => a.textContent === "Posts");
    expect(posts).toBeDefined();
    posts!.click();

    // Inner outlet swapped to the posts page; settings page is gone.
    await vi.waitFor(() => expect(container.textContent).toContain("Posts page"));
    expect(container.textContent).not.toContain("Settings page");

    // Layout persisted: same DOM node, counter retained.
    expect(container.querySelector("[data-user-layout]")).toBe(layoutEl);
    expect(container.querySelector("#count")?.textContent).toBe("1");
    expect(container.textContent).toContain("User 1");
  });

  it("renders the not-found page for an unmatched URL", async () => {
    await mountAt("/does/not/exist");
    await vi.waitFor(() => expect(container.textContent).toContain("404 — page not found"));
  });

  it("supports back/forward navigation via popstate", async () => {
    await mountAt("/users/1/settings");
    await vi.waitFor(() => expect(container.textContent).toContain("Settings page"));

    const posts = [...container.querySelectorAll("a")].find((a) => a.textContent === "Posts");
    posts!.click();
    await vi.waitFor(() => expect(container.textContent).toContain("Posts page"));

    // Back → popstate resyncs the router from window.location to the settings page.
    window.history.back();
    await vi.waitFor(() => expect(container.textContent).toContain("Settings page"));
    expect(container.textContent).not.toContain("Posts page");
  });

  it("renders the not-found page when a page raises notFound() during client navigation (N3)", async () => {
    // A tiny local tree: home links to `/gone`, whose page raises RouterNotFound.
    const def = Router.router(
      Router.layout(
        {
          component: Component.gen(function* () {
            const outlet = yield* Router.Outlet;
            return yield* h.div([outlet]);
          }),
        },
        [
          Router.route("", {
            component: Component.make(() =>
              h.div([h.a({ href: "/gone" }, "go"), h.span({ id: "home" }, "home")]),
            ),
          }),
          Router.route("gone", { component: () => notFound("/gone") }),
        ],
      ),
      { notFound: () => h.h2({ id: "nf" }, "client 404") },
    );

    await mountAt("/", def);
    await vi.waitFor(() => expect(container.querySelector("#home")).not.toBeNull());

    // SPA-navigate to /gone via a plain link click; the page raises notFound(),
    // which the router's internal boundary catches (post-mount, from a stream
    // child) and renders the configured not-found page in place.
    const go = [...container.querySelectorAll("a")].find((a) => a.textContent === "go");
    go!.click();
    await vi.waitFor(() => expect(container.querySelector("#nf")?.textContent).toBe("client 404"));
    expect(container.querySelector("#home")).toBeNull();
  });
});
