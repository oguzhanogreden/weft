import * as assert from "node:assert/strict";
import { Component, h } from "@effect-ui/core";
import { Rpc, RpcGroup } from "@effect/rpc";
import { Effect, Schema } from "effect";
import { describe, test } from "vite-plus/test";
import { Router, notFound } from "~/index";
import { RouterServer } from "~/server/router-server";

/** Minimal rpc foundation: these pages have no `Boundary.rpc`, but `rpc` is required. */
const NoopRpcs = RpcGroup.make(Rpc.make("Noop", { payload: Schema.Void, success: Schema.Void }));
const NoopLive = NoopRpcs.toLayer({ Noop: () => Effect.void });
const rpc = { group: NoopRpcs, handlers: NoopLive } as const;

const Home = () => h.h1({}, "Home page");
const About = () => h.h1({}, "About page");
const Gone = () => notFound("/gone");
const NotFound = () => h.h1({}, "404 — not found");

/** Reads its `:id` path param through the live match — proves platform-decoded path reaches render. */
const User = Component.gen(function* () {
  const { id } = yield* Router.params({ id: Schema.String });
  return yield* h.h1({}, `User ${id}`);
});

const def = Router.router(
  Router.layout(
    {
      component: Component.gen(function* () {
        const outlet = yield* Router.Outlet;
        return yield* h.div({ class: "shell" }, [outlet]);
      }),
    },
    [
      Router.route("", { component: Home }),
      Router.route("about", { component: About }),
      Router.route("gone", { component: Gone }),
      Router.route("users/:id", { component: User, path: { id: Schema.String } }),
      // Handler-arg props form: the leaf reads the live match's decoded `{ path, query }`
      // directly as props (no `Router.params`). Proves the outlet passes them in.
      Router.route("orders/:oid", {
        path: { oid: Schema.NumberFromString },
        query: { page: Schema.optional(Schema.NumberFromString) },
        component: ({ path, query }) => h.h1({}, `Order ${path.oid} page ${query.page ?? 0}`),
      }),
    ],
  ),
  { notFound: NotFound },
);

/** The document shell `component` — splices the app via the injected `Router.Outlet`. */
const document = Component.gen(function* () {
  const app = yield* Router.Outlet;
  return yield* h.html([h.head([h.title({}, "Test")]), h.body([h.div({ id: "root" }, [app])])]);
});

describe("RouterServer.render (dispatch via HttpApiBuilder)", () => {
  test("S1: platform matches the route and renders a hydratable document at status 200", async () => {
    const { html, status } = await Effect.runPromise(
      RouterServer.render(def, { document, rpc, url: "/about" }),
    );
    assert.equal(status, 200);
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes("About page"));
    assert.ok(html.includes('class="shell"'));
  });

  test("S1: platform-decoded path params reach the rendered page", async () => {
    const { html, status } = await Effect.runPromise(
      RouterServer.render(def, { document, rpc, url: "/users/42" }),
    );
    assert.equal(status, 200);
    assert.ok(html.includes("User 42"));
    assert.ok(html.includes('class="shell"'));
  });

  test("P1: leaf component receives the decoded handler-arg props (path + query)", async () => {
    const { html, status } = await Effect.runPromise(
      RouterServer.render(def, { document, rpc, url: "/orders/7?page=3" }),
    );
    assert.equal(status, 200);
    // Props passed in (not undefined) and decoded (`page` absent ⇒ default).
    assert.ok(html.includes("Order 7 page 3"));
    const noQuery = await Effect.runPromise(
      RouterServer.render(def, { document, rpc, url: "/orders/7" }),
    );
    assert.ok(noQuery.html.includes("Order 7 page 0"));
  });

  test("S2: no matching route ⇒ the not-found page with status 404 (sourced from platform)", async () => {
    const { html, status } = await Effect.runPromise(
      RouterServer.render(def, { document, rpc, url: "/missing" }),
    );
    assert.equal(status, 404);
    assert.ok(html.includes("404 — not found"));
  });

  test("S2: a page raising RouterNotFound ⇒ not-found page with status 404", async () => {
    const { html, status } = await Effect.runPromise(
      RouterServer.render(def, { document, rpc, url: "/gone" }),
    );
    assert.equal(status, 404);
    assert.ok(html.includes("404 — not found"));
  });

  test("toWebHandler: returns a text/html Response dispatched through the builder", async () => {
    const handler = RouterServer.toWebHandler(def, { document, rpc });
    const res = await handler(new Request("http://localhost/about"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.ok((await res.text()).includes("About page"));
  });

  test("toWebHandler: a no-match request is served the not-found page at 404", async () => {
    const handler = RouterServer.toWebHandler(def, { document, rpc });
    const res = await handler(new Request("http://localhost/missing"));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.ok((await res.text()).includes("404 — not found"));
  });
});
