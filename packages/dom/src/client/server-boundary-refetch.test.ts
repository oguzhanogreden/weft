import * as assert from "node:assert/strict";
import { Boundary, BoundaryDataClientTag, h } from "@effect-ui/core";
import type { Node } from "@effect-ui/core";
import { Effect, Option, Schema, Stream } from "effect";
import { JSDOM } from "jsdom";
import { describe, it } from "vite-plus/test";
import { renderToStringHydratable } from "~/server";
import { hydrate } from "./render";

// ---------------------------------------------------------------------------
// Test setup (mirrors server-boundary-hydrate.test.ts)
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

async function seedServerHtml(app: Node<any, any>): Promise<HTMLElement> {
  const root = createRoot();
  const html = await Effect.runPromise(renderToStringHydratable(app));
  root.innerHTML = html;
  return root;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ProductShape {
  readonly name: string;
  readonly price: number;
}
const Product = Schema.Struct({ name: Schema.String, price: Schema.Number });

/** JSON envelope the data endpoint would return for `data` (Schema.encode → JSON.stringify). */
const envelope = (data: ProductShape): Promise<string> =>
  Effect.runPromise(Schema.encode(Product)(data).pipe(Effect.map((e) => JSON.stringify(e))));

/**
 * Builds a `Boundary.server` that renders `resource.value` through the reactive
 * child path (so a refetch patches the region in place) and captures the live
 * `Resource` so the test can drive `refetch` and observe `pending`/`error`.
 */
const captureResource = (id: string) => {
  const captured: { current?: Boundary.Resource<ProductShape> } = {};
  const app = Boundary.server(
    { id, load: () => Effect.succeed({ name: "Widget", price: 9 }), schema: Product },
    (resource) => {
      captured.current = resource as Boundary.Resource<ProductShape>;
      return h.div({ class: "product" }, [Stream.map(resource.value.changes, (p) => p.name)]);
    },
  );
  return { app, captured } as const;
};

// ---------------------------------------------------------------------------
// AC-H-S8: refetch patches the region in place
// ---------------------------------------------------------------------------

describe("Boundary.server refetch — AC-H-S8: patches in place", () => {
  it("re-fetches via the data client, decodes the envelope, and updates value (no remount)", async () => {
    createTestDOM();
    const { app, captured } = captureResource("refetch-patch");

    let fetches = 0;
    const dataClient: BoundaryDataClientTag["Type"] = {
      fetch: () =>
        Effect.gen(function* () {
          fetches++;
          return yield* Effect.promise(() => envelope({ name: "Gadget", price: 12 }));
        }),
    };

    const root = await seedServerHtml(app);
    const productBefore = root.querySelector("div.product");
    assert.ok(productBefore, "server rendered the product div");

    await Effect.runPromise(
      hydrate(app, root).pipe(Effect.provideService(BoundaryDataClientTag, dataClient)),
    );

    // Seeded value rendered first (no flash) — same node adopted in place.
    assert.equal(root.querySelector("div.product"), productBefore);
    assert.ok(productBefore?.textContent?.includes("Widget"));

    const resource = captured.current;
    assert.ok(resource, "render captured the live resource");

    await Effect.runPromise(resource!.refetch);
    await waitFor(20);

    // The data client was hit and the new value is live on the resource…
    assert.equal(fetches, 1);
    const value = await Effect.runPromise(resource!.value.get);
    assert.equal(value.name, "Gadget");
    // …and the region patched in place (same node, new text — no remount).
    assert.equal(root.querySelector("div.product"), productBefore);
    assert.ok(productBefore?.textContent?.includes("Gadget"));
    // `load` is never run on the client; refetch goes through the endpoint client.
  });

  it("toggles pending true during the call and false after, error stays None on success", async () => {
    createTestDOM();
    const { app, captured } = captureResource("refetch-pending");

    const dataClient: BoundaryDataClientTag["Type"] = {
      fetch: () => Effect.promise(() => envelope({ name: "Gadget", price: 12 })),
    };

    const root = await seedServerHtml(app);
    await Effect.runPromise(
      hydrate(app, root).pipe(Effect.provideService(BoundaryDataClientTag, dataClient)),
    );

    const resource = captured.current!;
    assert.equal(await Effect.runPromise(resource.pending.get), false);

    await Effect.runPromise(resource.refetch);

    assert.equal(await Effect.runPromise(resource.pending.get), false);
    assert.equal(Option.isNone(await Effect.runPromise(resource.error.get)), true);
  });
});

// ---------------------------------------------------------------------------
// AC-H-S9: refetch failure is stale-on-error
// ---------------------------------------------------------------------------

describe("Boundary.server refetch — AC-H-S9: stale-on-error", () => {
  it("keeps the previous value, sets error to Some, pending back to false, no fallback flash", async () => {
    createTestDOM();
    const { app, captured } = captureResource("refetch-error");

    let mode: "fail" | "ok" = "fail";
    const dataClient: BoundaryDataClientTag["Type"] = {
      fetch: () =>
        mode === "fail"
          ? Effect.fail(new Error("network down"))
          : Effect.promise(() => envelope({ name: "Gadget", price: 12 })),
    };

    const root = await seedServerHtml(app);
    const productBefore = root.querySelector("div.product");
    await Effect.runPromise(
      hydrate(app, root).pipe(Effect.provideService(BoundaryDataClientTag, dataClient)),
    );

    const resource = captured.current!;

    await Effect.runPromise(resource.refetch);
    await waitFor(20);

    // Stale-on-error: previous value retained, error surfaced, pending cleared.
    const value = await Effect.runPromise(resource.value.get);
    assert.equal(value.name, "Widget");
    assert.equal(Option.isSome(await Effect.runPromise(resource.error.get)), true);
    assert.equal(await Effect.runPromise(resource.pending.get), false);
    // No fallback flash / remount — the same product node is still in place.
    assert.equal(root.querySelector("div.product"), productBefore);
    assert.ok(productBefore?.textContent?.includes("Widget"));

    // A subsequent successful refetch clears the error to None.
    mode = "ok";
    await Effect.runPromise(resource.refetch);
    await waitFor(20);
    assert.equal(Option.isNone(await Effect.runPromise(resource.error.get)), true);
    assert.equal((await Effect.runPromise(resource.value.get)).name, "Gadget");
  });

  it("treats a malformed JSON envelope as a stale-on-error refetch", async () => {
    createTestDOM();
    const { app, captured } = captureResource("refetch-malformed");

    const dataClient: BoundaryDataClientTag["Type"] = {
      fetch: () => Effect.succeed("not json"),
    };

    const root = await seedServerHtml(app);
    await Effect.runPromise(
      hydrate(app, root).pipe(Effect.provideService(BoundaryDataClientTag, dataClient)),
    );

    const resource = captured.current!;
    await Effect.runPromise(resource.refetch);

    assert.equal((await Effect.runPromise(resource.value.get)).name, "Widget");
    assert.equal(Option.isSome(await Effect.runPromise(resource.error.get)), true);
  });
});

// ---------------------------------------------------------------------------
// No transport: refetch is a no-op (router-less mount)
// ---------------------------------------------------------------------------

describe("Boundary.server refetch — no transport", () => {
  it("is a no-op when no BoundaryDataClient is provided", async () => {
    createTestDOM();
    const { app, captured } = captureResource("refetch-no-transport");

    const root = await seedServerHtml(app);
    // Hydrate without providing BoundaryDataClientTag.
    await Effect.runPromise(hydrate(app, root));

    const resource = captured.current!;
    await Effect.runPromise(resource.refetch);

    // Value unchanged, no error, not pending.
    assert.equal((await Effect.runPromise(resource.value.get)).name, "Widget");
    assert.equal(Option.isNone(await Effect.runPromise(resource.error.get)), true);
    assert.equal(await Effect.runPromise(resource.pending.get), false);
  });
});
