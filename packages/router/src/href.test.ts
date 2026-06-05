import * as assert from "node:assert/strict";
import { h } from "@effect-ui/core";
import { Schema } from "effect";
import { describe, test } from "vite-plus/test";
import { href } from "~/href";
import { match } from "~/matcher";
import { Router } from "~/index";

const Page = (label: string) => () => h.div({}, label);
const NotFound = () => h.h1({}, "404");

const userRoute = Router.route("users/:id", {
  path: { id: Schema.NumberFromString },
  component: Page("user"),
});
const searchRoute = Router.route("search", {
  query: { q: Schema.optional(Schema.String), page: Schema.optional(Schema.NumberFromString) },
  component: Page("search"),
});
const aboutRoute = Router.route("about", { component: Page("about") });

const def = Router.router(
  Router.layout("", { render: ({ outlet }) => outlet }, [userRoute, searchRoute, aboutRoute]),
  {
    notFound: NotFound,
  },
);

describe("href", () => {
  test("H1: encodes path params into the pattern", () => {
    assert.equal(href(userRoute, { path: { id: 42 } }), "/users/42");
  });

  test("H2: encodes query into a key-sorted search string; omits absent values", () => {
    assert.equal(href(searchRoute, { query: { q: "hi", page: 2 } }), "/search?page=2&q=hi");
    assert.equal(href(searchRoute, { query: { q: "hi" } }), "/search?q=hi");
    assert.equal(href(searchRoute, {}), "/search");
  });

  test("H3: round-trips with match", () => {
    const url = href(userRoute, { path: { id: 7 } });
    const m = match(def.compiled, url);
    assert.equal(m._tag, "Matched");
    if (m._tag === "Matched") {
      assert.equal(m.leaf.fullPathPattern, "/users/:id");
      assert.deepEqual(m.path, { id: 7 });
    }
  });

  test("H4: a no-param, no-query route needs no argument", () => {
    assert.equal(href(aboutRoute), "/about");
  });
});
