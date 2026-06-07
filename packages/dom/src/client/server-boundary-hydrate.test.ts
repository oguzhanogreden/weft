import * as assert from "node:assert/strict";
import { Boundary, ServerTag, h } from "@effect-ui/core";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { JSDOM } from "jsdom";
import { describe, it } from "vite-plus/test";
import { HydrationMismatchError } from "~/data";
import { renderToStringHydratable } from "~/server";
import { hydrate } from "./render";
import type { Node } from "@effect-ui/core";
import type { Renderable } from "@effect-ui/core/types";

/**
 * Adapts a v1-style `(data) => Node` render to the v3 `(resource) => Node`
 * signature by reading the resource's **seeded** value once. The replay seeds the
 * resource with the decoded payload, so `value.get` resolves synchronously to the
 * loaded data and the hydrated HTML is byte-identical to the bare-data render
 * these replay tests were written against (no reactive-region markers).
 */
const fromValue =
  <A, E, R>(f: (a: A) => Node<E, R>) =>
  (resource: Boundary.Resource<A>) =>
    Effect.gen(function* () {
      const data = yield* resource.value.get;
      return yield* f(data);
    });

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function createTestDOM(): JSDOM {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Comment = dom.window.Comment;
  global.Text = dom.window.Text;
  return dom;
}

function createRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

/** Renders `app` to hydratable HTML and seeds it into a fresh root. */
async function seedServerHtml(app: Renderable): Promise<HTMLElement> {
  const root = createRoot();
  const html = await Effect.runPromise(renderToStringHydratable(app));
  root.innerHTML = html;
  return root;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ProductShape {
  readonly name: string;
  readonly price: number;
}

const Product = Schema.Struct({ name: Schema.String, price: Schema.Number });

/**
 * A server-only data source, discharged at the boundary via `provide`. `calls`
 * counts every `load` invocation so tests can prove the client never runs it.
 */
const makeDatabase = () => {
  const state = { calls: 0 };
  class Database extends ServerTag("Database")<
    Database,
    { readonly getProduct: () => Effect.Effect<ProductShape> }
  >() {}
  const layer = Layer.succeed(Database, {
    getProduct: () =>
      Effect.sync(() => {
        state.calls++;
        return { name: "Widget", price: 9 };
      }),
  });
  return { Database, layer, state } as const;
};

// ---------------------------------------------------------------------------
// AC-H-S1 / AC-H-S2: replay (decode) without running `load`
// ---------------------------------------------------------------------------

describe("Boundary.server hydrate — replay, not retry", () => {
  it("decodes the inline payload and adopts render(data) without re-creating it", async () => {
    createTestDOM();
    const { Database, layer } = makeDatabase();
    const app = Boundary.server(
      {
        id: "replay-decode",
        load: () => Effect.flatMap(Database, (db) => db.getProduct()),
        provide: layer,
        schema: Product,
      },
      fromValue((data) => h.div({ class: "product" }, data.name)),
    );

    const root = await seedServerHtml(app);
    const serverDiv = root.querySelector("div.product");
    assert.ok(serverDiv, "server should have rendered the product div");
    (serverDiv as unknown as { __sentinel?: boolean }).__sentinel = true;

    await Effect.runPromise(hydrate(app, root));

    // Same node object survives — adopted in place, not re-created.
    assert.equal(root.querySelector("div.product"), serverDiv);
    assert.equal((serverDiv as unknown as { __sentinel?: boolean }).__sentinel, true);
    assert.equal(serverDiv?.textContent, "Widget");
  });

  it("never calls `load` on the client (replays the serialized result)", async () => {
    createTestDOM();
    const { Database, layer, state } = makeDatabase();
    const app = Boundary.server(
      {
        id: "replay-no-load",
        load: () => Effect.flatMap(Database, (db) => db.getProduct()),
        provide: layer,
        schema: Product,
      },
      fromValue((data) => h.div({ class: "product" }, data.name)),
    );

    const root = await seedServerHtml(app);
    // The server walk ran `load` once; reset and prove hydrate adds nothing.
    assert.equal(state.calls, 1);
    state.calls = 0;

    await Effect.runPromise(hydrate(app, root));

    assert.equal(state.calls, 0);
  });

  it("removes the inline payload script after hydration", async () => {
    createTestDOM();
    const app = Boundary.server(
      {
        id: "replay-remove-script",
        load: () => Effect.succeed({ name: "Widget", price: 9 }),
        provide: Layer.empty,
        schema: Product,
      },
      fromValue((data) => h.div({ class: "product" }, data.name)),
    );

    const root = await seedServerHtml(app);
    assert.ok(root.querySelector('script[type="application/json"]'), "payload present pre-hydrate");

    await Effect.runPromise(hydrate(app, root));

    assert.equal(root.querySelector('script[type="application/json"]'), null);
  });
});

// ---------------------------------------------------------------------------
// AC-H-S3: post-hydrate interactivity wired against adopted DOM
// ---------------------------------------------------------------------------

describe("Boundary.server hydrate — interactivity", () => {
  it("attaches a handler inside render(data) that fires post-hydrate", async () => {
    const dom = createTestDOM();
    let fired = 0;
    const app = Boundary.server(
      {
        id: "interactivity",
        load: () => Effect.succeed({ name: "Widget", price: 9 }),
        provide: Layer.empty,
        schema: Product,
      },
      fromValue((data) =>
        h.div({ class: "product" }, [
          h.span({}, data.name),
          h.button({ onclick: () => Effect.sync(() => void fired++) }, "buy"),
        ]),
      ),
    );

    const root = await seedServerHtml(app);
    await Effect.runPromise(hydrate(app, root));

    const button = root.querySelector("button");
    assert.ok(button);
    button?.dispatchEvent(new dom.window.Event("click"));
    await waitFor(50);

    assert.equal(fired, 1);
  });
});

// ---------------------------------------------------------------------------
// AC-H-S4: cursor stays aligned — siblings after the boundary still hydrate
// ---------------------------------------------------------------------------

describe("Boundary.server hydrate — cursor alignment", () => {
  it("steps the cursor past render(data) so a following sibling hydrates", async () => {
    createTestDOM();
    const app = h.div({}, [
      Boundary.server(
        {
          id: "cursor-align",
          load: () => Effect.succeed({ name: "Widget", price: 9 }),
          provide: Layer.empty,
          schema: Product,
        },
        fromValue((data) => h.span({ class: "product" }, data.name)),
      ),
      h.p({ class: "after" }, "after"),
    ]);

    const root = await seedServerHtml(app);
    const serverAfter = root.querySelector("p.after");
    assert.ok(serverAfter);
    (serverAfter as unknown as { __sentinel?: boolean }).__sentinel = true;

    await Effect.runPromise(hydrate(app, root));

    // The sibling was adopted (cursor aligned past the boundary's payload + HTML).
    assert.equal(root.querySelector("p.after"), serverAfter);
    assert.equal((serverAfter as unknown as { __sentinel?: boolean }).__sentinel, true);
    assert.equal(serverAfter?.textContent, "after");
  });

  it("hydrates nested server boundaries positionally", async () => {
    createTestDOM();
    const app = Boundary.server(
      {
        id: "nested-outer",
        load: () => Effect.succeed({ name: "Outer", price: 1 }),
        provide: Layer.empty,
        schema: Product,
      },
      fromValue((outer) =>
        h.div({ class: "outer" }, [
          outer.name,
          Boundary.server(
            {
              id: "nested-inner",
              load: () => Effect.succeed({ name: "Inner", price: 2 }),
              provide: Layer.empty,
              schema: Product,
            },
            fromValue((inner) => h.span({ class: "inner" }, inner.name)),
          ),
        ]),
      ),
    );

    const root = await seedServerHtml(app);
    await Effect.runPromise(hydrate(app, root));

    assert.equal(root.querySelector("span.inner")?.textContent, "Inner");
    assert.ok(root.querySelector("div.outer")?.textContent?.includes("Outer"));
    // Both payload scripts consumed.
    assert.equal(root.querySelectorAll('script[type="application/json"]').length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-H-S5: payload absence / decode failure → recoverable mismatch
// ---------------------------------------------------------------------------

describe("Boundary.server hydrate — payload divergence", () => {
  const boundaryApp = () =>
    Boundary.server(
      {
        id: "divergence",
        load: () => Effect.succeed({ name: "Widget", price: 9 }),
        provide: Layer.empty,
        schema: Product,
      },
      fromValue((data) => h.div({ class: "product" }, data.name)),
    );

  it("fails with HydrationMismatchError when the payload script is missing", async () => {
    createTestDOM();
    const root = createRoot();
    // Server HTML without the leading payload script (e.g. produced by plain SSR).
    root.innerHTML = '<div class="product">Widget</div>';

    const exit = await Effect.runPromiseExit(hydrate(boundaryApp(), root));

    assert.ok(Exit.isFailure(exit));
    assert.ok(Cause.squash(exit.cause) instanceof HydrationMismatchError);
  });

  it("fails with HydrationMismatchError when the payload is malformed JSON", async () => {
    createTestDOM();
    const root = createRoot();
    root.innerHTML =
      '<script type="application/json">not json</script><div class="product">Widget</div>';

    const exit = await Effect.runPromiseExit(hydrate(boundaryApp(), root));

    assert.ok(Exit.isFailure(exit));
    assert.ok(Cause.squash(exit.cause) instanceof HydrationMismatchError);
  });

  it("fails with HydrationMismatchError when the payload violates the schema", async () => {
    createTestDOM();
    const root = createRoot();
    // Valid JSON, wrong shape for `Product` (price is a string, not a number).
    root.innerHTML =
      '<script type="application/json">{"name":"Widget","price":"nine"}</script><div class="product">Widget</div>';

    const exit = await Effect.runPromiseExit(hydrate(boundaryApp(), root));

    assert.ok(Exit.isFailure(exit));
    assert.ok(Cause.squash(exit.cause) instanceof HydrationMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Typed-failure replay (core AC-16): decode the encoded `load` failure and
// reproduce the SAME enclosing-failure-boundary fallback without running `load`.
// ---------------------------------------------------------------------------

describe("Boundary.server hydrate — typed-failure replay", () => {
  class LoadError extends Schema.TaggedError<LoadError>()("LoadError", {
    reason: Schema.String,
  }) {}

  /** A failing-`load` server boundary under a `catchAll` that renders the error. */
  const makeFailingApp = (calls: { n: number }) =>
    Boundary.catchAll({ fallback: (e: LoadError) => h.div({ class: "fallback" }, e.reason) }, [
      Boundary.server(
        {
          id: "failure-replay",
          load: () =>
            Effect.sync(() => {
              calls.n++;
            }).pipe(Effect.flatMap(() => Effect.fail(new LoadError({ reason: "db down" })))),
          provide: Layer.empty,
          schema: Product,
          failure: LoadError,
        },
        fromValue((data) => h.div({ class: "product" }, data.name)),
      ),
    ]);

  it("replays the encoded failure into the same fallback without running load (AC-16)", async () => {
    createTestDOM();
    const calls = { n: 0 };
    const app = makeFailingApp(calls);

    const root = await seedServerHtml(app);
    assert.equal(calls.n, 1, "server ran load once");
    const serverFallback = root.querySelector("div.fallback");
    assert.ok(serverFallback, "server rendered the enclosing fallback");
    (serverFallback as unknown as { __sentinel?: boolean }).__sentinel = true;
    calls.n = 0;

    await Effect.runPromise(hydrate(app, root));

    // `load` is NOT re-run; the same fallback node is adopted in place.
    assert.equal(calls.n, 0, "client never runs load (replay, not retry)");
    assert.equal(root.querySelector("div.fallback"), serverFallback);
    assert.equal((serverFallback as unknown as { __sentinel?: boolean }).__sentinel, true);
    assert.equal(serverFallback?.textContent, "db down");
    // The failure payload script is consumed.
    assert.equal(root.querySelector("script[data-eui-boundary-failure]"), null);
    // The success subtree was never reproduced.
    assert.equal(root.querySelector("div.product"), null);
  });

  it("fails with a recoverable mismatch when the failure payload is malformed", async () => {
    createTestDOM();
    const root = createRoot();
    root.innerHTML =
      '<script type="application/json" data-eui-boundary-failure>not json</script><div class="fallback">db down</div>';

    const exit = await Effect.runPromiseExit(hydrate(makeFailingApp({ n: 0 }), root));

    assert.ok(Exit.isFailure(exit));
    assert.ok(Cause.squash(exit.cause) instanceof HydrationMismatchError);
  });
});
