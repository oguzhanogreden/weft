import { BoundaryDataClientTag } from "@effect-ui/core";
import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import {
  Context,
  Effect,
  Layer,
  Option,
  Runtime,
  Stream,
  Subscribable,
  SubscriptionRef,
} from "effect";
import type { RouterDef } from "../compile";
import { match, type RouteMatch } from "../matcher";
import { type NavigateOptions, Router, type RouterHttpApiClient } from "../router-service";
import { installLinkInterceptor } from "./link";

/** Options for {@link RouterLive}. */
export interface RouterLiveOptions {
  /**
   * Base URL for the derived `HttpApiClient`'s network requests (route prefetch /
   * future data). Defaults to the document's same origin (`window.location.origin`).
   */
  readonly baseUrl?: string | URL;
}

/** Reads the current location as a normalized `path + search` string. */
function locationUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Normalizes a navigation target (absolute or relative) to `path + search`. */
function normalizeTo(to: string): string {
  const url = new URL(to, window.location.href);
  return `${url.pathname}${url.search}`;
}

/**
 * The client `Router` layer, backed by the History API. Seeds a
 * `SubscriptionRef` from `window.location`, listens for `popstate`, and exposes
 * `currentMatch` as the ref mapped through the shared matcher. `navigate` pushes
 * History state and updates the ref. Also installs the same-origin link click
 * interceptor for the layer's lifetime.
 *
 * It additionally derives a real {@link RouterHttpApiClient} from `def.httpApi`
 * (over `FetchHttpClient`, `baseUrl` default same-origin) and exposes it on the
 * `Router` service for network work. SPA URL→leaf resolution stays local via the
 * shared {@link match}er — both sides read the one `def.httpApi` definition.
 *
 * The same derived client also backs the core {@link BoundaryDataClientTag}
 * transport, provided alongside `Router` so a hydrated `Boundary.server` can
 * `refetch` through `GET /_eui/data` without `@effect-ui/dom` depending on this
 * package.
 */
export function RouterLive(
  def: RouterDef,
  options?: RouterLiveOptions,
): Layer.Layer<Router | BoundaryDataClientTag> {
  return Layer.scopedContext(
    Effect.gen(function* () {
      const urlRef = yield* SubscriptionRef.make(locationUrl());
      const runtime = yield* Effect.runtime<never>();

      // The authoritative HttpApi is typed `HttpApi.Any` (runtime-assembled), so
      // `make` over it yields an opaque client and an unbounded requirement that
      // `FetchHttpClient.layer` discharges; the effect is asserted back to the
      // opaque `RouterHttpApiClient` with no residual context.
      const makeClient = HttpApiClient.make(
        // oxlint-disable-next-line typescript/no-explicit-any
        def.httpApi as any,
        { baseUrl: options?.baseUrl ?? window.location.origin },
      ).pipe(
        Effect.provide(FetchHttpClient.layer),
      ) as unknown as Effect.Effect<RouterHttpApiClient>;
      const httpApiClient = yield* makeClient;

      // popstate (back/forward) → resync the ref from the live location.
      const onPopState = (): void => {
        Runtime.runFork(runtime)(SubscriptionRef.set(urlRef, locationUrl()));
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener("popstate", onPopState)),
        () => Effect.sync(() => window.removeEventListener("popstate", onPopState)),
      );

      const navigate = (to: string, options?: NavigateOptions): Effect.Effect<void> =>
        Effect.gen(function* () {
          const normalized = normalizeTo(to);
          yield* Effect.sync(() => {
            // `replaceState` swaps the current entry (no new history step);
            // `pushState` adds one. Neither fires `popstate`, so the ref is set
            // explicitly below to drive the reactive re-render.
            if (options?.replace === true) {
              window.history.replaceState(null, "", normalized);
            } else {
              window.history.pushState(null, "", normalized);
            }
          });
          yield* SubscriptionRef.set(urlRef, normalized);
        });

      yield* installLinkInterceptor(def, navigate);

      const currentMatch = Subscribable.make({
        get: Effect.map(SubscriptionRef.get(urlRef), (url): RouteMatch => match(def, url)),
        changes: Stream.map(urlRef.changes, (url): RouteMatch => match(def, url)),
      });

      // The core boundary-refetch transport: a thin wrapper over the derived
      // client's `_eui_data.boundaryData` endpoint, returning the raw JSON
      // envelope. `@effect-ui/dom` reads this tag to refetch a hydrated
      // `Boundary.server` without importing this package. The endpoint shape is
      // runtime-assembled (`HttpApi.Any`), so the call is reached through the
      // opaque client cast.
      const dataClient = BoundaryDataClientTag.of({
        fetch: (request) =>
          // oxlint-disable-next-line typescript/no-explicit-any
          (httpApiClient as any)._eui_data.boundaryData({
            urlParams: { id: request.id, params: request.params },
          }) as Effect.Effect<string, unknown>,
      });

      const router = Router.of({
        currentMatch,
        navigate,
        httpApiClient: Option.some(httpApiClient),
      });

      return Context.make(Router, router).pipe(Context.add(BoundaryDataClientTag, dataClient));
    }),
  );
}
