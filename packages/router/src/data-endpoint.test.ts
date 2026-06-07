import * as assert from "node:assert/strict";
import { Boundary, ServerTag, h } from "@effect-ui/core";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "vite-plus/test";
import { serveBoundaryData } from "./data-endpoint";
import { BoundaryDataNotFound } from "./errors";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ProductShape {
  readonly name: string;
  readonly price: number;
}
const Product = Schema.Struct({ name: Schema.String, price: Schema.Number });

// ---------------------------------------------------------------------------
// AC-D2: registered id → encoded JSON envelope
// ---------------------------------------------------------------------------

describe("serveBoundaryData — AC-D2: registered id returns the encoded envelope", () => {
  it("re-runs the registered load and returns the schema-encoded JSON string", async () => {
    // Constructing a Boundary.server registers { id → { load, provide, schema } }.
    Boundary.server(
      {
        id: "endpoint-basic",
        load: () => Effect.succeed({ name: "Widget", price: 9 }),
        schema: Product,
      },
      () => h.div("x"),
    );

    const envelope = await Effect.runPromise(serveBoundaryData({ id: "endpoint-basic" }));

    // The envelope is the SAME encode the inline SSR payload uses (AC-D6): it
    // JSON.parses and Schema.decodes back to the loaded data.
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(Product)(JSON.parse(envelope) as unknown),
    );
    assert.deepEqual(decoded, { name: "Widget", price: 9 });
  });

  it("discharges the boundary's server-only `provide` when running load (AC-D4)", async () => {
    class Inventory extends ServerTag("Inventory")<
      Inventory,
      { readonly read: () => ProductShape }
    >() {}
    const InventoryLive = Layer.succeed(Inventory, {
      read: () => ({ name: "Gadget", price: 12 }),
    });

    Boundary.server(
      {
        id: "endpoint-provide",
        load: () => Inventory.pipe(Effect.map((inv) => inv.read())),
        provide: InventoryLive,
        schema: Product,
      },
      () => h.div("x"),
    );

    // `serveBoundaryData`'s channel requires nothing (provide is discharged
    // internally) — it runs without supplying Inventory.
    const envelope = await Effect.runPromise(serveBoundaryData({ id: "endpoint-provide" }));
    assert.deepEqual(JSON.parse(envelope), { name: "Gadget", price: 12 });
  });
});

// ---------------------------------------------------------------------------
// AC-D3: unknown / pruned id → BoundaryDataNotFound (404)
// ---------------------------------------------------------------------------

describe("serveBoundaryData — AC-D3: unknown id fails with BoundaryDataNotFound", () => {
  it("fails with BoundaryDataNotFound for an unregistered id", async () => {
    const exit = await Effect.runPromiseExit(
      serveBoundaryData({ id: "endpoint-never-registered" }),
    );
    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof BoundaryDataNotFound);
    assert.equal((error as BoundaryDataNotFound).id, "endpoint-never-registered");
  });

  it("carries the requested id on the error", async () => {
    const exit = await Effect.runPromiseExit(serveBoundaryData({ id: "missing-xyz" }));
    assert.ok(Exit.isFailure(exit));
    assert.equal((Cause.squash(exit.cause) as BoundaryDataNotFound).id, "missing-xyz");
  });
});
