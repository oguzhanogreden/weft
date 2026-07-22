/**
 * End-to-end browser test for the router-client example.
 *
 * Mounts the real `App` in Chromium with the History-API `Router` and asserts
 * the headline behaviour of a client-only SPA:
 *
 * - intercepted link clicks navigate without a full page load,
 * - the `Shell` layout's DOM node survives navigations (layout persistence),
 * - `/users/:id` decodes its path param into typed handler-arg props,
 * - a `?sort=` query-only navigation re-sorts the list in place (same leaf
 *   node, `Router.queryStream` reader updates),
 * - an unknown id renders the app-level 404 page via `notFound()`.
 */

import { WeftApp } from "@weftui/dom/client";
import { Router, RouterApp, RouterLive } from "@weftui/router/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";

let container: HTMLElement;
let app: WeftApp.WeftApp<Router> | undefined;

beforeEach(() => {
  container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
});

afterEach(async () => {
  if (app !== undefined) await Effect.runPromise(WeftApp.dispose(app));
  app = undefined;
  container.remove();
  window.history.replaceState(null, "", "/");
});

const mountAt = async (path: string): Promise<void> => {
  window.history.replaceState(null, "", path);
  app = WeftApp.make(RouterLive(App));
  await Effect.runPromise(WeftApp.mount(app, RouterApp(App), container));
};

/** Clicks the first anchor matching `selector` + text; bubbles to the interceptor. */
const clickLink = (selector: string, text: string): void => {
  const anchor = [...container.querySelectorAll<HTMLAnchorElement>(selector)].find(
    (a) => a.textContent === text,
  );
  expect(anchor).not.toBeUndefined();
  anchor!.click();
};

const waitForHeading = (text: string): Promise<void> =>
  vi.waitFor(() => expect(container.querySelector("#page h2")?.textContent).toBe(text));

const listedNames = (): readonly string[] =>
  [...container.querySelectorAll<HTMLAnchorElement>("#user-list a")].map(
    (a) => a.textContent ?? "",
  );

describe("router-client example", () => {
  it("navigates via intercepted link clicks while the Shell stays mounted", async () => {
    await mountAt("/");
    await waitForHeading("Home");

    const header = container.querySelector("#shell-header");
    expect(header).not.toBeNull();

    clickLink("nav a", "Users");
    await waitForHeading("Users");
    expect(window.location.pathname).toBe("/users");

    // Layout persistence: the same header DOM node, not a re-created one.
    expect(container.querySelector("#shell-header")).toBe(header);
  });

  it("decodes /users/:id into typed handler-arg props", async () => {
    await mountAt("/users");
    await waitForHeading("Users");

    clickLink("#user-list a", "Grace");
    await waitForHeading("Grace");
    expect(container.querySelector("#user-role")?.textContent).toBe("#2: admiral");
    expect(window.location.pathname).toBe("/users/2");
  });

  it("re-sorts in place on a query-only navigation", async () => {
    await mountAt("/users");
    await waitForHeading("Users");
    await vi.waitFor(() => expect(listedNames()).toEqual(["Ada", "Grace", "Linus"]));

    const page = container.querySelector("#page");

    clickLink(".sort a", "desc");
    await vi.waitFor(() =>
      expect(container.querySelector("#user-list")?.getAttribute("data-sort")).toBe("desc"),
    );
    expect(listedNames()).toEqual(["Linus", "Grace", "Ada"]);

    // Query-only navigation: the leaf stays mounted, only the list re-renders.
    expect(container.querySelector("#page")).toBe(page);
  });

  it("renders the 404 page for an unknown id via notFound()", async () => {
    await mountAt("/users/999");
    await waitForHeading("404: page not found");
  });
});
