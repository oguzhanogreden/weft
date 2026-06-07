import { lookup } from "@effect-ui/core";
import { Effect, Layer, Schema } from "effect";
import { BoundaryDataNotFound } from "./errors";

/**
 * Decoded url-params of the `boundaryData` endpoint (`GET /_eui/data`). `id` keys
 * the core boundary registry; `params` is the optional JSON-encoded load input the
 * boundary keyed on (transport only — see note in {@link serveBoundaryData}).
 */
export interface BoundaryDataRequest {
  readonly id: string;
  readonly params?: string | undefined;
}

/**
 * Server-side handler body for the router data endpoint backing `Boundary.server`
 * refetch (`data-endpoint.specs.md`, AC-D2 … AC-D4). Looks up `request.id` in the
 * core module-level registry, re-runs the registered `load` **on the server** with
 * its `provide` layer, `Schema.encode`s the result via the boundary's `schema`, and
 * returns the JSON string envelope — the **same** encode the inline SSR payload
 * uses (`render-to-stream.ts`), so the client decode path (`JSON.parse` →
 * `Schema.decode(schema)`) is identical for hydrate and refetch (AC-D6).
 *
 * An unknown `id` (or a client-pruned entry whose `load` was stripped) fails with
 * {@link BoundaryDataNotFound} (→ HTTP 404, AC-D3). `load`/`provide`/`RServer` never
 * leave the server; only the encoded `A` is returned (AC-D4).
 *
 * The registry stores `load` as a **nullary thunk** (it closes over the route
 * params it needs at descriptor-build time), so `request.params` is carried at the
 * transport layer but not threaded into `load` in this phase; a future load-input
 * redesign would consume it. `load`/encode failures are promoted to defects here so
 * the endpoint's declared error channel stays exactly `BoundaryDataNotFound`.
 */
export function serveBoundaryData(
  request: BoundaryDataRequest,
): Effect.Effect<string, BoundaryDataNotFound> {
  return Effect.gen(function* () {
    const entry = lookup(request.id);
    if (entry === undefined || entry.load === undefined) {
      return yield* Effect.fail(new BoundaryDataNotFound({ id: request.id }));
    }
    const load = entry.load;
    const provide = entry.provide ?? Layer.empty;
    // Registry types are erased (the value-level map is keyed by string); the
    // server-only discharge guarantee (`provide` consumes `load`'s requirements)
    // is structural, not expressible here, so the provided effect is asserted
    // fully-discharged. `orDie` keeps the endpoint channel = BoundaryDataNotFound.
    const data = yield* Effect.orDie(
      Effect.provide(load(), provide) as Effect.Effect<unknown, unknown>,
    );
    const encoded = yield* Effect.orDie(Schema.encode(entry.schema)(data));
    return JSON.stringify(encoded);
  });
}
