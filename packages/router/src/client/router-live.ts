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

/**
 * The residual app services a caller must still provide through the {@link RouterLiveOptions.context}
 * seam — a def's aggregate `R` minus the services `RouterLive` already threads
 * (`Router`, `Router.Outlet`, `AppRpcClientTag`). The client mirror of
 * `RouterServer.AppServices`; resolves to `never` for an app with no app-wide service.
 */
export type AppServices<R> = Exclude<R, Router | Router.Outlet | AppRpcClientTag>;

/** True only for the exact `any` type — a loosely-typed `RouterDef<any, any>`. */
// oxlint-disable-next-line typescript/no-explicit-any
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Conditionally shapes the `context` field: **required** when the def has statically
 * known residual {@link AppServices}, **absent** when it has none, and **optional**
 * for a loosely-typed `RouterDef<any, any>`. Client parity with the server seam (AC4)
 * is thus a compile-time guarantee, and no-service / loosely-typed apps stay unchanged (AC3).
 */
export type ContextOption<R> = [AppServices<R>] extends [never]
  ? { readonly context?: undefined }
  : IsAny<AppServices<R>> extends true
    ? // oxlint-disable-next-line typescript/no-explicit-any
      { readonly context?: Layer.Layer<any, never, never> }
    : { readonly context: Layer.Layer<AppServices<R>, never, never> };

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
   * network rpc client. Optional: omit when the app has no `Boundary.rpc` — then
   * no network rpc client is built and a stray `Boundary.rpc` fails with a
   * descriptive error.
   */
  readonly rpc?: {
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
export function RouterLive<R>(
  def: RouterDef<any, R>,
  options: RouterLiveOptions & ContextOption<R> = {} as RouterLiveOptions & ContextOption<R>,
): Layer.Layer<Router | AppRpcClientTag | AppServices<R>> {
  const core: Layer.Layer<Router | AppRpcClientTag> = Layer.scopedContext(
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
      // With no `rpc` configured the seam is a stub whose `call` fails
      // descriptively, so a stray `Boundary.rpc` surfaces the misconfiguration.
      const rpc = options.rpc;
      let appRpcClient: AppRpcClientTag["Type"];
      if (rpc === undefined) {
        appRpcClient = AppRpcClientTag.of({
          call: (tag) =>
            Effect.fail(
              new Error(
                `Boundary.rpc "${tag}" cannot resolve: no \`rpc\` option was passed to RouterLive`,
              ),
            ),
        });
      } else {
        const baseUrl = String(options.baseUrl ?? window.location.origin).replace(/\/$/, "");
        const flatClient = yield* RpcClient.make(rpc.group, { flatten: true }).pipe(
          Effect.provide(
            RpcClient.layerProtocolHttp({ url: `${baseUrl}${RPC_PATH}` }).pipe(
              Layer.provide(Layer.mergeAll(FetchHttpClient.layer, RpcSerialization.layerJson)),
            ),
          ),
          // The group is runtime-assembled (`RpcGroup<any>`); the flat caller is
          // reached through the same loosening the core seam documents.
          // oxlint-disable-next-line typescript/no-explicit-any
        ) as Effect.Effect<any, never, never>;
        appRpcClient = AppRpcClientTag.of({
          call: (tag, payload) => flatClient(tag, payload),
        });
      }

      const router = Router.of({
        currentMatch,
        navigate,
        httpApiClient: Option.some(httpApiClient),
      });

      return Context.make(Router, router).pipe(Context.add(AppRpcClientTag, appRpcClient));
    }),
  );

  // The render-time provide seam (AC4): the app-wide `context` Layer is merged into
  // the router layer, so the `ManagedRuntime` the client mounts under carries the
  // app services and every hydrated route/layout leaf reads them via `yield* Service`.
  // No context ⇒ the bare `core` layer, unchanged for `rpc`-only / no-service apps.
  const context = (options as { readonly context?: Layer.Layer<AppServices<R>, never, never> })
    .context;
  // When no context is provided the residual `AppServices<R>` is empty, so widening
  // `core` to the declared return type is sound (nothing extra is actually promised).
  return (context === undefined ? core : Layer.merge(core, context)) as Layer.Layer<
    Router | AppRpcClientTag | AppServices<R>
  >;
}
