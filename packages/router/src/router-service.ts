import { Context, type Effect, type Subscribable } from "effect";
import type { RouteMatch } from "./matcher";

/**
 * The universal router service. Provided per render — by `RouterLive` on the
 * client (History-API backed) and by a fixed per-request implementation on the
 * server. Layouts and pages read it anywhere via `yield* Router`.
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
