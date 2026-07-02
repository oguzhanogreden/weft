import * as assert from "node:assert/strict";
import { AppRpcClientTag, Component, h } from "@weftui/core";
import { Rpc, RpcGroup } from "@effect/rpc";
import { Context, Effect, Exit, Fiber, Layer, Option, Schema } from "effect";
import { JSDOM } from "jsdom";
import { afterEach, describe, test } from "vite-plus/test";
import { Router } from "~/index";
import { RouterLive, type RouterLiveOptions } from "~/client/router-live";
import type { RouterDef } from "~/compile";
import type { ComponentSlot } from "~/route-tree";

/** Minimal rpc group: the fixture has no `Boundary.rpc`, but `rpc` is required. */
const NoopRpcs = RpcGroup.make(Rpc.make("Noop", { payload: Schema.Void, success: Schema.Void }));

const Page = (label: string) => () => h.div({}, label);

/** An app-wide service exercised through the render-time `context` seam (AC4). */
class Greeting extends Context.Tag("test/Greeting")<Greeting, string>() {}

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
function readService(options?: Partial<RouterLiveOptions>): Promise<Router["Type"]> {
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

/** A fixture whose leaf reads the `Greeting` app service, so the def's `R` carries it. */
function greetingFixture() {
  return Router.router(
    Router.layout({ component: passthrough }, [
      Router.route("", {
        component: Component.gen(function* () {
          return yield* h.div({}, yield* Greeting);
        }),
      }),
    ]),
    { notFound: () => h.h1({}, "404") },
  );
}

describe("RouterLive render-time context seam (AC4)", () => {
  test("AC4: a service provided via `context` is merged into the layer and read by the hydrated tree", async () => {
    setupDom();
    const value = await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            return yield* Greeting;
          }),
          // The same seam the client entry uses: the app service rides alongside
          // `Router` / `AppRpcClientTag`, so a `yield* Greeting` in the tree resolves.
          RouterLive(greetingFixture(), { context: Layer.succeed(Greeting, "hi-from-context") }),
        ),
      ),
    );
    assert.equal(value, "hi-from-context");
  });
});

// ── Pending (deferred-commit) navigation (`pending-navigation.specs.md`) ────────

/** Reads the `Router` service exposed by `RouterLive(def)` for an arbitrary def. */
function readServiceFor(def: RouterDef): Promise<Router["Type"]> {
  return Effect.runPromise(
    Effect.scoped(Effect.provide(Router, RouterLive(def, { rpc: { group: NoopRpcs } }))),
  );
}

/** A controllable lazy loader: a gate promise plus its resolver. */
function gateLoader(slot: ComponentSlot): {
  readonly load: () => Promise<ComponentSlot>;
  readonly resolve: () => void;
} {
  let resolve!: (s: ComponentSlot) => void;
  const gate = new Promise<ComponentSlot>((r) => {
    resolve = r;
  });
  return { load: () => gate, resolve: () => resolve(slot) };
}

/** Yields to the macrotask queue so a forked navigation runs its synchronous prefix. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const readNav = (s: Router["Type"]): Promise<{ readonly _tag: string; readonly to?: string }> =>
  Effect.runPromise(s.navigating.get);
const readMatch = (s: Router["Type"]): Promise<{ readonly _tag: string; readonly url?: string }> =>
  Effect.runPromise(s.currentMatch.get);

describe("RouterLive — pending navigation (deferred commit)", () => {
  test("AC-N1/AC-N5: a lazy nav holds match + url until the chunk resolves; navigating Idle→Navigating→Idle", async () => {
    setupDom();
    const g = gateLoader(Component.make(() => h.div({}, "lazy")));
    const def = Router.router(
      Router.layout({ component: passthrough }, [
        Router.route("about", { component: Page("about") }),
        Router.route("lazy", { component: Router.lazy(g.load) }),
      ]),
      { notFound: () => h.h1({}, "404") },
    );
    const service = await readServiceFor(def);
    assert.equal((await readNav(service))._tag, "Idle");

    const fiber = Effect.runFork(service.navigate("/lazy"));
    await tick();
    // Mid-flight: navigating reports the target, but url + match have NOT moved.
    assert.deepEqual(await readNav(service), { _tag: "Navigating", to: "/lazy" });
    assert.equal((await readMatch(service))._tag, "NotFound");
    assert.equal(dom.window.location.pathname, "/");

    g.resolve();
    await Effect.runPromise(Fiber.join(fiber));
    // Committed: url + match moved together, navigating back to Idle.
    assert.equal(dom.window.location.pathname, "/lazy");
    assert.equal((await readMatch(service))._tag, "Matched");
    assert.equal((await readNav(service))._tag, "Idle");
  });

  test("AC-N3: an eager nav is synchronous and never emits Navigating", async () => {
    setupDom();
    const service = await readServiceFor(fixture());
    await Effect.runPromise(service.navigate("/about"));
    assert.equal(dom.window.location.pathname, "/about");
    assert.equal((await readMatch(service))._tag, "Matched");
    assert.equal((await readNav(service))._tag, "Idle");
  });

  test("AC-N7: latest-wins — a superseded lazy nav never commits", async () => {
    setupDom();
    const a = gateLoader(Component.make(() => h.div({}, "a")));
    const b = gateLoader(Component.make(() => h.div({}, "b")));
    const def = Router.router(
      Router.layout({ component: passthrough }, [
        Router.route("a", { component: Router.lazy(a.load) }),
        Router.route("b", { component: Router.lazy(b.load) }),
      ]),
      { notFound: () => h.h1({}, "404") },
    );
    const service = await readServiceFor(def);

    const fiberA = Effect.runFork(service.navigate("/a"));
    const fiberB = Effect.runFork(service.navigate("/b"));
    await tick();
    assert.deepEqual(await readNav(service), { _tag: "Navigating", to: "/b" });

    // Resolve the stale nav first: it must NOT commit or reset state.
    a.resolve();
    await Effect.runPromise(Fiber.join(fiberA));
    assert.equal(dom.window.location.pathname, "/");
    assert.deepEqual(await readNav(service), { _tag: "Navigating", to: "/b" });

    // Resolve the latest nav: it commits.
    b.resolve();
    await Effect.runPromise(Fiber.join(fiberB));
    assert.equal(dom.window.location.pathname, "/b");
    assert.equal((await readNav(service))._tag, "Idle");
  });

  test("AC-N9: a rejected chunk load dies (defect), resets navigating, leaves the match unchanged", async () => {
    setupDom();
    const def = Router.router(
      Router.layout({ component: passthrough }, [
        Router.route("boom", {
          component: Router.lazy(() => Promise.reject(new Error("chunk gone"))),
        }),
      ]),
      { notFound: () => h.h1({}, "404") },
    );
    const service = await readServiceFor(def);
    // A rejected load is a defect (AC-E1): the navigation fails rather than hanging.
    const exit = await Effect.runPromise(Effect.exit(service.navigate("/boom")));
    assert.equal(Exit.isFailure(exit), true);
    assert.equal((await readNav(service))._tag, "Idle");
    assert.equal((await readMatch(service))._tag, "NotFound");
    assert.equal(dom.window.location.pathname, "/");
  });
});

describe("RouterLive — base path (base.specs.md)", () => {
  test("AC: seeds the initial match from location with the base stripped", async () => {
    setupDom("http://localhost/weft/about");
    const service = await readService({ base: "/weft" });
    const m = await readMatch(service);
    assert.equal(m._tag, "Matched");
    assert.equal(m.url, "/about");
  });

  test("AC: navigate('/users/42') pushes '/weft/users/42' while match.url stays canonical", async () => {
    setupDom("http://localhost/weft/about");
    const service = await readService({ base: "/weft" });
    await Effect.runPromise(service.navigate("/users/42"));
    assert.equal(dom.window.location.pathname, "/weft/users/42");
    const m = await readMatch(service);
    assert.equal(m._tag, "Matched");
    assert.equal(m.url, "/users/42");
  });

  test("AC: a location outside the base yields a no-match (404) rather than a crash", async () => {
    setupDom("http://localhost/other");
    const service = await readService({ base: "/weft" });
    assert.equal((await readMatch(service))._tag, "NotFound");
  });
});
