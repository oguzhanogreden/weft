import type { Effect, Layer, Schema } from "effect";

/**
 * A `Boundary.server`'s server-only load definition, registered under its `id`
 * so the router's data endpoint can re-run it for a client refetch (see
 * `packages/router/src/data-endpoint.specs.md`). The fields mirror the
 * server-only half of `ServerProps`.
 *
 * On the **server** every field is populated. On the **client** the prune plugin
 * (`@effect-ui/vite`) has stripped `load`/`provide` from the call site, so those
 * fields hold `undefined` — harmless, since the client never serves the endpoint.
 */
export interface RegisteredBoundary {
  /** Thunk producing the server `load` effect; `undefined` on a pruned client bundle. */
  readonly load?: () => Effect.Effect<unknown, unknown, unknown>;
  /** Layer discharging `load`'s server-only requirements; `undefined` on a pruned client bundle. */
  readonly provide?: Layer.Layer<unknown>;
  /** Wire contract for the loaded value `A`. */
  readonly schema: Schema.Schema<any, any>;
  /** Wire contract for a typed `load` failure, when `load` can fail. */
  readonly failure?: Schema.Schema<any, any>;
}

/**
 * Module-level registry of `Boundary.server` load definitions keyed by their
 * required `id`. Populated at **descriptor-build time** (when `Boundary.server`
 * is constructed), independent of render, so any server process that has loaded
 * the module graph can serve a refetch for a given `id`.
 *
 * Consulted only on the **server** (by the router data endpoint). Module-level
 * (not a Service) precisely because it must be reachable from the endpoint
 * handler without threading the render tree.
 */
const registry = new Map<string, RegisteredBoundary>();

/**
 * Register a `Boundary.server`'s load definition under `id`. Called from
 * `Boundary.server` at descriptor-build time. A duplicate `id` overwrites the
 * previous entry (last registration wins — authors must keep `id`s unique).
 */
export function register(id: string, entry: RegisteredBoundary): void {
  registry.set(id, entry);
}

/**
 * Look up a registered boundary by `id`. Returns `undefined` for an unknown
 * `id`; the router data endpoint maps that to a `BoundaryDataNotFound` 404.
 */
export function lookup(id: string): RegisteredBoundary | undefined {
  return registry.get(id);
}
