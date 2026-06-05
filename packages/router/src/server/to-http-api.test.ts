import * as assert from "node:assert/strict";
import { h } from "@effect-ui/core";
import { Schema } from "effect";
import { describe, test } from "vite-plus/test";
import { Router } from "~/index";
import { toHttpApi } from "~/server/to-http-api";

const Page = (label: string) => () => h.div({}, label);

const def = Router.router(
  Router.layout("", { render: ({ outlet }) => outlet }, [
    Router.route("about", { component: Page("about") }),
    Router.route("users/:id", { path: { id: Schema.NumberFromString }, component: Page("user") }),
    Router.route("search", {
      query: { q: Schema.optional(Schema.String) },
      component: Page("search"),
    }),
  ]),
  { notFound: () => h.h1({}, "404") },
);

describe("toHttpApi", () => {
  test("S4: produces a single 'pages' group with one GET endpoint per leaf", () => {
    // The generated HttpApi's static type is intentionally loose (see to-http-api.ts).
    const api = toHttpApi(def) as unknown as {
      readonly groups: Record<
        string,
        {
          readonly identifier: string;
          readonly endpoints: Record<string, { readonly path: string; readonly method: string }>;
        }
      >;
    };

    assert.deepEqual(Object.keys(api.groups), ["pages"]);
    assert.equal(api.groups.pages!.identifier, "pages");

    const endpoints = Object.values(api.groups.pages!.endpoints);
    assert.equal(endpoints.length, def.compiled.leaves.length);
    for (const endpoint of endpoints) {
      assert.equal(endpoint.method, "GET");
    }
    const paths = endpoints.map((e) => e.path).sort();
    assert.deepEqual(paths, ["/about", "/search", "/users/:id"]);
  });
});
