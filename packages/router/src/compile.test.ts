import * as assert from "node:assert/strict";
import { Component, h } from "@weftui/core";
import { HttpApiSchema } from "effect/unstable/httpapi";
import { Either, Option, Schema, SchemaAST as AST } from "effect";
import { describe, test } from "vite-plus/test";
import type { CompiledLeaf } from "~/compile";
import { Router } from "~/index";

const Page = (label: string) => () => h.div({}, label);
const NotFound = () => h.h1({}, "404");

/** A layout `component` that wraps the injected outlet in a `div`. */
const wrap = (attrs: Record<string, string>) =>
  Component.gen(function* () {
    const outlet = yield* Router.Outlet;
    return yield* h.div(attrs, [outlet]);
  });

const idParam = { id: Schema.NumberFromString };

function fixture() {
  return Router.router(
    Router.layout({ component: wrap({ class: "shell" }) }, [
      Router.route("", { component: Page("home") }),
      Router.route("about", { component: Page("about") }),
      Router.route("users/new", { component: Page("new") }),
      Router.route("search", {
        query: { q: Schema.optional(Schema.String) },
        component: Page("search"),
      }),
      Router.layout({ component: wrap({}) }, [
        Router.route("users/:id/settings", { path: idParam, component: Page("settings") }),
        Router.route("users/:id/posts", { path: idParam, component: Page("posts") }),
      ]),
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
    // id is declared on the leaf route (NumberFromString) for its `:id` placeholder.
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
    const { compiled } = Router.router(
      Router.layout({ component: wrap({}) }, [
        Router.route("tags/:tag", { component: Page("tag") }),
      ]),
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

/** Loose view of the built `HttpApi`'s runtime structure (static type is loose). */
interface HttpApiView {
  readonly groups: Record<
    string,
    {
      readonly identifier: string;
      readonly endpoints: Record<
        string,
        {
          readonly name: string;
          readonly path: string;
          readonly method: string;
          readonly pathSchema: Option.Option<Schema.Schema<unknown, unknown>>;
          readonly urlParamsSchema: Option.Option<Schema.Schema<unknown, unknown>>;
          readonly errorSchema: Schema.Schema<unknown, unknown>;
        }
      >;
    }
  >;
}

describe("httpApi spine", () => {
  const def = fixture();
  const api = def.httpApi as unknown as HttpApiView;
  const endpoints = Object.values(api.groups.pages!.endpoints);

  test("S4: a 'pages' group with one GET endpoint per leaf, at each full path", () => {
    // The `pages` group carries the route leaves. There is no data group on the
    // HttpApi spine: `Boundary.rpc` data is served by a separate rpc web handler
    // mounted at `POST /_eui/rpc`, not an HttpApi endpoint.
    assert.deepEqual(Object.keys(api.groups).sort(), ["pages"]);
    assert.equal(api.groups.pages!.identifier, "pages");
    assert.equal(endpoints.length, def.compiled.leaves.length);
    for (const endpoint of endpoints) assert.equal(endpoint.method, "GET");
    assert.deepEqual(endpoints.map((e) => e.path).sort(), [
      "/",
      "/about",
      "/search",
      "/users/:id/posts",
      "/users/:id/settings",
      "/users/new",
    ]);
  });

  test("endpoint names are the compiled leaf ids (httpApi ↔ index join key)", () => {
    assert.deepEqual(
      endpoints.map((e) => e.name).sort(),
      def.compiled.leaves.map((l) => l.id).sort(),
    );
  });

  test("each endpoint carries real path + urlParams schemas (no `as any` bridge)", () => {
    for (const endpoint of endpoints) {
      assert.ok(Option.isSome(endpoint.pathSchema), `${endpoint.path} has a path schema`);
      assert.ok(Option.isSome(endpoint.urlParamsSchema), `${endpoint.path} has a urlParams schema`);
    }
    // The `:id` path schema decodes through the leaf's `NumberFromString`.
    const settings = endpoints.find((e) => e.path === "/users/:id/settings")!;
    const pathSchema = Option.getOrThrow(settings.pathSchema);
    assert.deepEqual(Schema.decodeUnknownSync(pathSchema)({ id: "42" }), { id: 42 });
  });

  test("each endpoint declares a RouterNotFound → 404 error", () => {
    for (const endpoint of endpoints) {
      // The status annotation lives on each union member's AST (the top union node
      // carries none), so walk members and assert 404 is among the declared errors.
      const ast = endpoint.errorSchema.ast as {
        readonly _tag: string;
        readonly types?: readonly AST.AST[];
      };
      const members = ast._tag === "Union" ? ast.types! : [ast as unknown as AST.AST];
      const statuses = members.map((m) => HttpApiSchema.getStatusErrorAST(m));
      assert.ok(statuses.includes(404), `${endpoint.path} declares a 404 error`);

      const decoded = Schema.decodeUnknownEither(endpoint.errorSchema)({ _tag: "RouterNotFound" });
      assert.ok(Either.isRight(decoded), `${endpoint.path} error decodes a RouterNotFound`);
    }
  });
});
