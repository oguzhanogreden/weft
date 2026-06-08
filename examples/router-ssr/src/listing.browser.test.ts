/**
 * End-to-end browser test for the listing's `?sort=` **query param**.
 *
 * The `/products` page reads the decoded `query` from its handler-arg props and
 * renders the catalog sorted by `query.sort`. A query-only navigation (`patchQuery`)
 * re-invokes the leaf with the new query, so the grid re-sorts. This asserts the
 * resulting card order for two different `?sort=` values.
 */

import { mount, type MountHandle } from "@effect-ui/dom/client";
import { patchQuery, Router, RouterApp, RouterLive } from "@effect-ui/router/client";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { StockRpcs } from "./data/inventory";

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

const mountAt = async (path: string): Promise<void> => {
  window.history.replaceState(null, "", path);
  runtime = ManagedRuntime.make(RouterLive(App, { rpc: { group: StockRpcs } }));
  handle = await runtime.runPromise(mount(RouterApp(App), container));
};

/** The product ids of the rendered cards, in DOM order. */
const cardIds = (): readonly string[] =>
  [...container.querySelectorAll<HTMLElement>("#grid .card")].map((el) => el.dataset.product ?? "");

describe("router-ssr shop — listing sort query", () => {
  it("re-sorts the grid when ?sort= changes", async () => {
    // Mount sorted by name.
    await mountAt("/products?sort=name");

    // Name order: Aeropress(1), Burr(2), Digital Scale(5), Gooseneck(3), Pour-over(4), Tumbler(6).
    await vi.waitFor(() => expect(cardIds()).toEqual(["1", "2", "5", "3", "4", "6"]));

    // Query-only change → the leaf re-renders sorted by ascending price.
    await runtime.runPromise(patchQuery({ sort: "price-asc" }));
    await vi.waitFor(() => expect(cardIds()).toEqual(["4", "6", "1", "5", "3", "2"]));
  });
});
