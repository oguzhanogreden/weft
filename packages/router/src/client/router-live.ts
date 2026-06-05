import { Effect, Layer, Runtime, Stream, Subscribable, SubscriptionRef } from "effect";
import type { RouterDef } from "../compile";
import { match, type RouteMatch } from "../matcher";
import { Router } from "../router-service";
import { installLinkInterceptor } from "./link";

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
 */
export function RouterLive(def: RouterDef): Layer.Layer<Router> {
  return Layer.scoped(
    Router,
    Effect.gen(function* () {
      const urlRef = yield* SubscriptionRef.make(locationUrl());
      const runtime = yield* Effect.runtime<never>();

      // popstate (back/forward) → resync the ref from the live location.
      const onPopState = (): void => {
        Runtime.runFork(runtime)(SubscriptionRef.set(urlRef, locationUrl()));
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener("popstate", onPopState)),
        () => Effect.sync(() => window.removeEventListener("popstate", onPopState)),
      );

      const navigate = (to: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const normalized = normalizeTo(to);
          yield* Effect.sync(() => window.history.pushState(null, "", normalized));
          yield* SubscriptionRef.set(urlRef, normalized);
        });

      yield* installLinkInterceptor(def.compiled, navigate);

      const currentMatch = Subscribable.make({
        get: Effect.map(SubscriptionRef.get(urlRef), (url): RouteMatch => match(def.compiled, url)),
        changes: Stream.map(urlRef.changes, (url): RouteMatch => match(def.compiled, url)),
      });

      return Router.of({ currentMatch, navigate });
    }),
  );
}
