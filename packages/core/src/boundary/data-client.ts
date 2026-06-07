import { Context, type Effect } from "effect";

/**
 * Client transport for endpoint-backed `Boundary.server` refetch. A thin,
 * package-neutral seam: the DOM client renderer builds a boundary's live
 * `Resource` during `hydrate` and needs to call the router's `GET /_eui/data`
 * endpoint, but `@effect-ui/dom` must not depend on `@effect-ui/router`. So the
 * transport is injected as a service — `@effect-ui/router` (`RouterLive`) provides
 * it, backed by the derived `HttpApiClient`; the renderer reads it from the
 * ambient context and is `Option.none` when no router is present (e.g. a plain
 * client-only mount, where refetch is a no-op).
 *
 * The service returns the **raw JSON envelope string** (the endpoint's
 * `Schema.String` success): decoding (`JSON.parse` → `Schema.decode(schema)`) is
 * owned by the renderer, mirroring the inline-payload hydrate decode so SSR replay
 * and refetch share one decode path (`server.specs.md` AC-D6).
 */
export interface BoundaryDataClient {
  /**
   * Fetches the `schema`-encoded JSON envelope for the boundary registered under
   * `request.id`, optionally carrying the JSON-encoded `params` the loader keyed
   * on. Resolves the router data endpoint over the network; the error channel is
   * opaque (`unknown`) since transport/HTTP failures are surfaced to the resource's
   * stale-on-error `error` channel, never raised into a failure `Boundary`.
   */
  readonly fetch: (request: {
    readonly id: string;
    readonly params?: string;
  }) => Effect.Effect<string, unknown>;
}

/**
 * Context tag for the {@link BoundaryDataClient} transport. Provided on the client
 * by `@effect-ui/router`'s `RouterLive`; absent on the server (which is itself the
 * data endpoint's origin) and in router-less mounts.
 */
export class BoundaryDataClientTag extends Context.Tag("@effect-ui/core/BoundaryDataClient")<
  BoundaryDataClientTag,
  BoundaryDataClient
>() {}
