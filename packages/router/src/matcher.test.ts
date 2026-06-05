import * as assert from "node:assert/strict";
import { Component, h } from "@effect-ui/core";
import { Schema } from "effect";
import { describe, test } from "vite-plus/test";
import { match } from "~/matcher";
import { Router } from "~/index";

const Page = (label: string) => () => h.div({}, label);
const NotFound = () => h.h1({}, "404");

/** A passthrough layout `component`: renders the injected outlet directly. */
const passthrough = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  return yield* outlet;
});

function fixture() {
  return Router.router(
    Router.layout({ component: passthrough }, [
      Router.route("about", { component: Page("about") }),
      Router.route("users/new", { component: Page("new") }),
      Router.route("users/:id", { path: { id: Schema.NumberFromString }, component: Page("user") }),
      Router.route("search", {
        query: { q: Schema.optional(Schema.String) },
        component: Page("search"),
      }),
    ]),
    { notFound: NotFound },
  ).compiled;
}

describe("match", () => {
  test("M1: a static pattern matches exactly that path", () => {
    const m = match(fixture(), "/about");
    assert.equal(m._tag, "Matched");
    if (m._tag === "Matched") assert.equal(m.leaf.fullPathPattern, "/about");
  });

  test("M2: a path-param pattern captures and decodes the param", () => {
    const m = match(fixture(), "/users/42");
    assert.equal(m._tag, "Matched");
    if (m._tag === "Matched") {
      assert.equal(m.leaf.fullPathPattern, "/users/:id");
      assert.deepEqual(m.path, { id: 42 });
    }
  });

  test("M3: trailing slashes are normalized", () => {
    const withSlash = match(fixture(), "/users/42/");
    const without = match(fixture(), "/users/42");
    assert.equal(withSlash._tag, "Matched");
    if (withSlash._tag === "Matched" && without._tag === "Matched") {
      assert.equal(withSlash.leaf.fullPathPattern, without.leaf.fullPathPattern);
      assert.deepEqual(withSlash.path, without.path);
    }
  });

  test("M4: query decodes through the leaf query schema", () => {
    const m = match(fixture(), "/search?q=hello");
    assert.equal(m._tag, "Matched");
    if (m._tag === "Matched") assert.deepEqual(m.query, { q: "hello" });
    const empty = match(fixture(), "/search");
    if (empty._tag === "Matched") assert.deepEqual(empty.query, {});
  });

  test("M5: no matching leaf ⇒ NotFound", () => {
    assert.equal(match(fixture(), "/nope")._tag, "NotFound");
  });

  test("M6: a static segment wins over a param segment at the same position", () => {
    const m = match(fixture(), "/users/new");
    assert.equal(m._tag, "Matched");
    if (m._tag === "Matched") assert.equal(m.leaf.fullPathPattern, "/users/new");
  });

  test("M7: a path-param decode failure is a no-match, not an error", () => {
    // :id is NumberFromString; "abc" cannot decode ⇒ no leaf matches.
    assert.equal(match(fixture(), "/users/abc")._tag, "NotFound");
  });
});
