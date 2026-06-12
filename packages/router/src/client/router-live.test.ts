import * as assert from "node:assert/strict";
import { AppRpcClientTag, Component, h } from "@weftui/core";
import { Rpc, RpcGroup } from "@effect/rpc";
import { Effect, Option, Schema } from "effect";
import { JSDOM } from "jsdom";
import { afterEach, describe, test } from "vite-plus/test";
import { Router } from "~/index";
import { RouterLive } from "~/client/router-live";

/** Minimal rpc group: the fixture has no `Boundary.rpc`, but `rpc` is required. */
const NoopRpcs = RpcGroup.make(Rpc.make("Noop", { payload: Schema.Void, success: Schema.Void }));

const Page = (label: string) => () => h.div({}, label);

/** A passthrough layout `component`: renders the injected outlet directly. */
const passthrough = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  return yield* outlet;
});

function fixture() {
  return Router.router(
    Router.layout({ component: passthrough }, [
      Router.route("about", { component: Page("about") }),
      Router.route("users/:id", { path: { id: Schema.NumberFromString }, component: Page("user") }),
    ]),
    { notFound: () => h.h1({}, "404") },
  );
}

let dom: JSDOM;

/** Sets up a fresh JSDOM (window/document + the globals `RouterLive` reads). */
function setupDom(url = "http://localhost/"): void {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url });
  global.window = dom.window as unknown as Window & typeof globalThis;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.MouseEvent = dom.window.MouseEvent;
  global.HTMLAnchorElement = dom.window.HTMLAnchorElement;
}

afterEach(() => {
  // Restore a clean window between tests.
  dom.window.close();
});

/** Reads the `Router` service exposed by `RouterLive(def, options)`. */
function readService(options?: Partial<Parameters<typeof RouterLive>[1]>): Promise<Router["Type"]> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          return yield* Router;
        }),
        RouterLive(fixture(), { rpc: { group: NoopRpcs }, ...options }),
      ),
    ),
  );
}

describe("RouterLive — derived HttpApiClient", () => {
  test("CL1: exposes the derived HttpApiClient on the Router service as Option.some", async () => {
    setupDom();
    const service = await readService();
    assert.equal(Option.isSome(service.httpApiClient), true);
    if (Option.isSome(service.httpApiClient)) {
      // The client carries the api's "pages" group of endpoint methods.
      const client = service.httpApiClient.value as Record<string, unknown>;
      assert.equal(typeof client, "object");
      assert.ok("pages" in client);
    }
  });

  test("CL2: accepts a configurable baseUrl (defaults to same origin otherwise)", async () => {
    setupDom();
    // A custom baseUrl is accepted and the client still derives successfully.
    const service = await readService({ baseUrl: "https://api.example.com" });
    assert.equal(Option.isSome(service.httpApiClient), true);
  });
});

describe("RouterLive without rpc (rpc optional)", () => {
  test("provides Router with the options argument omitted entirely", async () => {
    setupDom();
    const service = await Effect.runPromise(
      Effect.scoped(Effect.provide(Router, RouterLive(fixture()))),
    );
    assert.equal(Option.isSome(service.httpApiClient), true);
  });

  test("the provided AppRpcClientTag fails descriptively when `rpc` is omitted", async () => {
    setupDom();
    const failure = await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            const client = yield* AppRpcClientTag;
            return yield* Effect.flip(client.call("GetStock", undefined));
          }),
          RouterLive(fixture(), {}),
        ),
      ),
    );
    assert.ok(failure instanceof Error);
    assert.ok(failure.message.includes("GetStock"));
    assert.ok(failure.message.includes("rpc"));
  });
});
