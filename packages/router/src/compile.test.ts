import * as assert from "node:assert/strict";
import { h } from "@effect-ui/core";
import { Schema } from "effect";
import { describe, test } from "vite-plus/test";
import type { CompiledLeaf } from "~/compile";
import { layout, route, router } from "~/index";

const Page = (label: string) => () => h.div({}, label);
const NotFound = () => h.h1({}, "404");

function fixture() {
  return router(
    layout("", (outlet) => h.div({ class: "shell" }, [outlet]), [
      route("", Page("home")),
      route("about", Page("about")),
      route("users/new", Page("new")),
      route("search", { query: { q: Schema.optional(Schema.String) } }, Page("search")),
      layout(
        "users/:id",
        { path: { id: Schema.NumberFromString } },
        (outlet) => h.div({}, [outlet]),
        [route("settings", Page("settings")), route("posts", Page("posts"))],
      ),
    ]),
    { notFound: NotFound },
  );
}

function leafByPattern(leaves: readonly CompiledLeaf[], pattern: string): CompiledLeaf {
  const leaf = leaves.find((l) => l.fullPathPattern === pattern);
  assert.ok(leaf, `expected a leaf for ${pattern}`);
  return leaf;
}

describe("compile", () => {
  test("C1: one leaf per route, in document order", () => {
    const { compiled } = fixture();
    assert.equal(compiled.leaves.length, 6);
    assert.deepEqual(
      compiled.leaves.map((l) => l.fullPathPattern),
      ["/", "/about", "/users/new", "/search", "/users/:id/settings", "/users/:id/posts"],
    );
  });

  test("C2: full path patterns are normalized (root ⇒ '/', no trailing slash)", () => {
    const { compiled } = fixture();
    assert.equal(leafByPattern(compiled.leaves, "/").fullPathPattern, "/");
    assert.equal(
      leafByPattern(compiled.leaves, "/users/:id/settings").fullPathPattern,
      "/users/:id/settings",
    );
  });

  test("C3 & C6: path schema merges branch params (layout-owned :id, defaulted otherwise)", () => {
    const { compiled } = fixture();
    const settings = leafByPattern(compiled.leaves, "/users/:id/settings");
    assert.deepEqual(settings.paramNames, ["id"]);
    // id is owned by the parent layout's NumberFromString schema, merged down.
    const decoded = Schema.decodeUnknownSync(settings.pathSchema)({ id: "42" });
    assert.deepEqual(decoded, { id: 42 });
  });

  test("C4: query schema is the leaf's own fields (empty struct when none)", () => {
    const { compiled } = fixture();
    const search = leafByPattern(compiled.leaves, "/search");
    assert.deepEqual(Schema.decodeUnknownSync(search.querySchema)({ q: "hi" }), { q: "hi" });
    const about = leafByPattern(compiled.leaves, "/about");
    assert.deepEqual(Schema.decodeUnknownSync(about.querySchema)({}), {});
  });

  test("C6: an undeclared `:name` placeholder defaults to Schema.String", () => {
    const { compiled } = router(
      layout("", (outlet) => outlet, [route("tags/:tag", Page("tag"))]),
      { notFound: NotFound },
    );
    const tag = leafByPattern(compiled.leaves, "/tags/:tag");
    assert.deepEqual(tag.paramNames, ["tag"]);
    // No `path` config was given, so `:tag` is keyed and decodes as a raw string.
    assert.deepEqual(Schema.decodeUnknownSync(tag.pathSchema)({ tag: "effect" }), {
      tag: "effect",
    });
  });

  test("C5: leaf carries its ordered layout chain with cumulative prefixes", () => {
    const { compiled } = fixture();
    const settings = leafByPattern(compiled.leaves, "/users/:id/settings");
    assert.deepEqual(
      settings.layoutChain.map((l) => l.patternPrefix),
      ["/", "/users/:id"],
    );
    const home = leafByPattern(compiled.leaves, "/");
    assert.deepEqual(
      home.layoutChain.map((l) => l.patternPrefix),
      ["/"],
    );
  });
});
