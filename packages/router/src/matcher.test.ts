import * as assert from "node:assert/strict";
import { Component, h } from "@weftui/core";
import { Schema } from "effect";
import { describe, test } from "vite-plus/test";
import { match } from "~/matcher";
import { Router } from "~/index";

const Page = (label: string) => () => h.div({}, label);
const NotFound = () => h.h1({}, "404");

// Effect 4's `NumberFromString` maps a non-numeric string to `NaN` rather than
// failing, so add a finite check: an invalid `:id` (e.g. "abc") is then a real
// decode failure the matcher treats as a no-match (M7).
const IdParam = Schema.NumberFromString.pipe(
  Schema.check(
    Schema.makeFilter((n) => (Number.isFinite(n) ? undefined : "expected a finite number")),
  ),
);

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
      Router.route("users/:id", { path: { id: IdParam }, component: Page("user") }),
      Router.route("search", {
        query: { q: Schema.optional(Schema.String) },
        component: Page("search"),
      }),
    ]),
    { notFound: NotFound },
  );
}

describe("match", () => {
  test("M0: matcher entries are sourced from the httpApi pages endpoints", () => {
    const def = fixture();
    // The single source of truth: every leaf the matcher resolves corresponds to a
    // `def.httpApi` "pages" endpoint (same id + path), not a parallel structure.
    const endpoints = (
      def.httpApi as unknown as {
        groups: Record<string, { endpoints: Record<string, { name: string; path: string }> }>;
      }
    ).groups["pages"]?.endpoints;
    assert.ok(endpoints !== undefined);
    for (const endpoint of Object.values(endpoints)) {
      // A static path resolves directly; the param leaf is keyed by its own id.
      const probe = endpoint.path.replace(/:[^/]+/g, "42");
      const m = match(def, probe);
      assert.equal(m._tag, "Matched");
      if (m._tag === "Matched") assert.equal(m.leaf.id, endpoint.name);
    }
  });

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
