import * as assert from "node:assert/strict";
import { h } from "@effect-ui/core";
import type { Node } from "@effect-ui/core";
import { Effect } from "effect";
import { describe, test } from "vite-plus/test";
import { layout, notFound, route, router } from "~/index";
import { RouterServer } from "~/server/router-server";

const Home = () => h.h1({}, "Home page");
const About = () => h.h1({}, "About page");
const Gone = () => notFound("/gone");
const NotFound = () => h.h1({}, "404 — not found");

const def = router(
  layout("", (outlet) => h.div({ class: "shell" }, [outlet]), [
    route("", Home),
    route("about", About),
    route("gone", Gone),
  ]),
  { notFound: NotFound },
);

const document = (app: Node<any, any>): Node<any, any> =>
  h.html([h.head([h.title({}, "Test")]), h.body([h.div({ id: "root" }, [app])])]);

describe("RouterServer.render", () => {
  test("S1: renders the matched route to a hydratable document with status 200", async () => {
    const { html, status } = await Effect.runPromise(
      RouterServer.render(def, { document, url: "/about" }),
    );
    assert.equal(status, 200);
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes("About page"));
    assert.ok(html.includes('class="shell"'));
  });

  test("S2: no matching route ⇒ the not-found page with status 404", async () => {
    const { html, status } = await Effect.runPromise(
      RouterServer.render(def, { document, url: "/missing" }),
    );
    assert.equal(status, 404);
    assert.ok(html.includes("404 — not found"));
  });

  test("S2: a page raising RouterNotFound ⇒ not-found page with status 404", async () => {
    const { html, status } = await Effect.runPromise(
      RouterServer.render(def, { document, url: "/gone" }),
    );
    assert.equal(status, 404);
    assert.ok(html.includes("404 — not found"));
  });

  test("toWebHandler: returns a text/html Response", async () => {
    const handler = RouterServer.toWebHandler(def, { document });
    const res = await handler(new Request("http://localhost/about"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.ok((await res.text()).includes("About page"));
  });
});
