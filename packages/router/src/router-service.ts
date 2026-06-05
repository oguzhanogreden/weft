import { Context, type Effect, type Subscribable } from "effect";
import { makeRouter } from "./compile";
import type { RouteMatch } from "./matcher";
import { makeLayout, makeRoute } from "./route-tree";

/**
 * The universal router service. Provided per render — by `RouterLive` on the
 * client (History-API backed) and by a fixed per-request implementation on the
 * server. Layouts and pages read it anywhere via `yield* Router`.
 *
 * The `Router` symbol is also the authoring namespace: {@link Router.route},
 * {@link Router.layout}, and {@link Router.router} build the route tree (mirroring
 * `Component.gen` / `Boundary.catchTag` / `h.div`). The two roles merge by
 * declaration — `yield* Router` reads the service; `Router.route(…)` authors a tree.
 */
export class Router extends Context.Tag("@effect-ui/router/Router")<
  Router,
  {
    /** The current match as a hot `Subscribable`; drives the outlet. */
    readonly currentMatch: Subscribable.Subscribable<RouteMatch>;
    /**
     * Navigates to `to` (a path, optionally with a query). On the client this
     * pushes History state and re-renders the affected outlet; on the server it
     * is a no-op (navigation is a client concern).
     */
    readonly navigate: (to: string) => Effect.Effect<void>;
  }
>() {}

// oxlint-disable-next-line no-namespace -- declaration merge: authoring combinators on the Router Tag
export namespace Router {
  /** Declares a leaf page. See {@link makeRoute}. */
  export const route = makeRoute;
  /** Declares a layout wrapping a typed outlet. See {@link makeLayout}. */
  export const layout = makeLayout;
  /** Seals a route tree into a `RouterDef`. See {@link makeRouter}. */
  export const router = makeRouter;
}
