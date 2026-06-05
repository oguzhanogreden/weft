import * as assert from "node:assert/strict";
import { Effect, Exit } from "effect";
import { describe, test } from "vite-plus/test";
import { isRouterNotFound, notFound, RouterNotFound } from "~/errors";

describe("errors", () => {
  test("N1: notFound() fails with a RouterNotFound", () => {
    const exit = Effect.runSyncExit(notFound("/missing"));
    assert.ok(Exit.isFailure(exit));
    const error = Exit.isFailure(exit) ? Effect.runSync(Effect.flip(notFound("/missing"))) : null;
    assert.ok(error instanceof RouterNotFound);
    assert.equal(error?._tag, "RouterNotFound");
    assert.equal(error?.path, "/missing");
  });

  test("N2: RouterNotFound is recognised by its tag guard", () => {
    assert.ok(isRouterNotFound(new RouterNotFound({ path: "/x" })));
    assert.ok(!isRouterNotFound({ _tag: "Other" }));
    assert.ok(!isRouterNotFound(null));
  });
});
