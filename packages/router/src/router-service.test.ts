import * as assert from "node:assert/strict";
import { Component, h } from "@effect-ui/core";
import { Effect, Exit, Schema, Stream, Subscribable } from "effect";
import { describe, test } from "vite-plus/test";
import { Router, RouterParamsError } from "~/index";
import { match, type RouteMatch } from "~/matcher";

const idParam = { id: Schema.NumberFromString };
const sortQuery = { sort: Schema.optional(Schema.String) };

const def = Router.router(
  Router.layout(
    {
      component: Component.gen(function* () {
        const outlet = yield* Router.Outlet;
        return yield* outlet;
      }),
    },
    [
      Router.route("users/:id", {
        path: idParam,
        query: sortQuery,
        component: Component.make(() => h.div({}, "user")),
      }),
      Router.route("about", { component: Component.make(() => h.div({}, "about")) }),
    ],
  ),
  { notFound: () => h.h1({}, "404") },
);

/** A fixed-match `Router` service over a resolved match. */
const routerFor = (m: RouteMatch): Router["Type"] =>
  Router.of({
    currentMatch: Subscribable.make({ get: Effect.succeed(m), changes: Stream.make(m) }),
    navigate: () => Effect.void,
  });

/** Runs an accessor against the match for `url`, returning its `Exit`. */
function runAt<A, E>(eff: Effect.Effect<A, E, Router>, url: string): Promise<Exit.Exit<A, E>> {
  return Effect.runPromise(
    Effect.exit(Effect.provideService(eff, Router, routerFor(match(def.compiled, url)))),
  );
}

describe("Router.params / Router.query", () => {
  test("Router.params decodes the live match's path params", async () => {
    const exit = await runAt(Router.params(idParam), "/users/42");
    assert.deepEqual(exit, Exit.succeed({ id: 42 }));
  });

  test("Router.query decodes the live match's query (present and absent)", async () => {
    const present = await runAt(Router.query(sortQuery), "/users/42?sort=asc");
    assert.deepEqual(present, Exit.succeed({ sort: "asc" }));
    const absent = await runAt(Router.query(sortQuery), "/users/42");
    assert.deepEqual(absent, Exit.succeed({ sort: undefined }));
  });

  test("Router.params fails with RouterParamsError (source: path) when no route matches", async () => {
    const exit = await runAt(Router.params(idParam), "/nope");
    assert.ok(Exit.isFailure(exit));
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.provideService(
          Router.params(idParam),
          Router,
          routerFor(match(def.compiled, "/nope")),
        ),
      ),
    );
    assert.ok(error instanceof RouterParamsError);
    assert.equal(error.source, "path");
    assert.deepEqual([...error.keys], ["id"]);
  });

  test("Router.params fails with RouterParamsError when the match lacks the requested key", async () => {
    // `/about` has no `:id`, so requesting it fails Type-side validation.
    const exit = await runAt(Router.params(idParam), "/about");
    assert.ok(Exit.isFailure(exit));
  });

  test("Router.query fails with RouterParamsError (source: query) when no route matches", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.provideService(
          Router.query(sortQuery),
          Router,
          routerFor(match(def.compiled, "/nope")),
        ),
      ),
    );
    assert.ok(error instanceof RouterParamsError);
    assert.equal(error.source, "query");
  });
});
