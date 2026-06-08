import { AppRpcClientTag } from "@weftui/core";
import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import { type RpcGroup, RpcClient, RpcSerialization } from "@effect/rpc";
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

/** Path the client rpc protocol posts to; mirrors `RouterServer`'s server route. */
const RPC_PATH = "/_eui/rpc";

/** Options for {@link RouterLive}. */
export interface RouterLiveOptions {
  /**
   * Base URL for the derived `HttpApiClient` (route prefetch) and the rpc client's
   * `POST /_eui/rpc` endpoint. Defaults to the document's same origin
   * (`window.location.origin`).
   */
  readonly baseUrl?: string | URL;
  /**
   * The app's `Boundary.rpc` foundation: the merged `RpcGroup` contract (shared
   * with the server handler Layer). Backs the {@link AppRpcClientTag} seam so a
   * hydrated boundary refetch — and a client-first SPA mount — resolve over the
   * network rpc client.
   */
  readonly rpc: {
    /** The app's merged `RpcGroup` (pure Schema contract). */
    // oxlint-disable-next-line typescript/no-explicit-any
    readonly group: RpcGroup.RpcGroup<any>;
  };
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
 * Alongside `Router` it provides the core {@link AppRpcClientTag} seam — a
 * **network** flat rpc client (`RpcClient.make` over `layerProtocolHttp` →
 * `POST /_eui/rpc`) — so `@weftui/dom` can resolve a `Boundary.rpc` (hydrated
 * refetch and client-first mount) without depending on this package or
 * `@effect/rpc`.
 */
export function RouterLive(
  def: RouterDef,
  options: RouterLiveOptions,
): Layer.Layer<Router | AppRpcClientTag> {
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
        { baseUrl: options.baseUrl ?? window.location.origin },
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

      // The {@link AppRpcClientTag} seam: a **network** flat rpc client over the
      // app's merged `RpcGroup`, posting to `<origin>/_eui/rpc`. `@weftui/dom`
      // reads this tag to resolve a `Boundary.rpc` — hydrated refetch and
      // client-first mount — without importing this package or `@effect/rpc`.
      const baseUrl = String(options.baseUrl ?? window.location.origin).replace(/\/$/, "");
      const flatClient = yield* RpcClient.make(options.rpc.group, { flatten: true }).pipe(
        Effect.provide(
          RpcClient.layerProtocolHttp({ url: `${baseUrl}${RPC_PATH}` }).pipe(
            Layer.provide(Layer.mergeAll(FetchHttpClient.layer, RpcSerialization.layerJson)),
          ),
        ),
        // The group is runtime-assembled (`RpcGroup<any>`); the flat caller is
        // reached through the same loosening the core seam documents.
        // oxlint-disable-next-line typescript/no-explicit-any
      ) as Effect.Effect<any, never, never>;
      const appRpcClient = AppRpcClientTag.of({
        call: (tag, payload) => flatClient(tag, payload),
      });

      const router = Router.of({
        currentMatch,
        navigate,
        httpApiClient: Option.some(httpApiClient),
      });

      return Context.make(Router, router).pipe(Context.add(AppRpcClientTag, appRpcClient));
    }),
  );
}
