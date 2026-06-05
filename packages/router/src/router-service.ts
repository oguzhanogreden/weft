import type { Node } from "@effect-ui/core";
import { Context, Effect, Either, Schema, type Subscribable } from "effect";
import { makeRouter } from "./compile";
import { RouterParamsError } from "./errors";
import type { RouteMatch } from "./matcher";
import type { Fields, FieldsType } from "./route-tree";
import { makeLayout, makeRoute } from "./route-tree";

/**
 * The universal router service. Provided per render — by `RouterLive` on the
 * client (History-API backed) and by a fixed per-request implementation on the
 * server. Layouts and pages read it anywhere via `yield* Router`.
 *
 * The `Router` symbol is also the authoring namespace: {@link Router.route},
 * {@link Router.layout}, and {@link Router.router} build the route tree (mirroring
 * `Component.gen` / `Boundary.catchTag` / `h.div`), and {@link Router.Outlet} /
 * {@link Router.params} / {@link Router.query} deliver the outlet and the live
 * match's params/query by dependency injection. The roles merge by declaration —
 * `yield* Router` reads the service; `Router.route(…)` authors a tree.
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

/**
 * The injected outlet: the node a layout (or the server document shell) splices
 * to place the next level down. Provided per render by the router
 * (`Effect.provideService(layout.component({}), OutletTag, innerNode)`); a layout
 * reads it with `yield* Router.Outlet`.
 *
 * Typed **opaque** as `Node<never, never>` so splicing `[outlet]` adds nothing to
 * a layout's local channels — the subtree's real channels are aggregated
 * structurally by {@link makeLayout} / {@link makeRouter}, never inferred across
 * this DI boundary. Re-exported on the namespace as `Router.Outlet`.
 */
class OutletTag extends Context.Tag("@effect-ui/router/Outlet")<OutletTag, Node<never, never>>() {}

/** Picks the requested `fields` keys out of a decoded match record. */
function pick<F extends Fields>(
  fields: F,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const subset: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) subset[key] = record[key];
  return subset;
}

/**
 * Reads the live match's **path params** for the requested `fields`. Snapshot
 * semantics — reads `yield* Router` then `currentMatch.get` — and validates the
 * already-decoded values against the `Type` side of `Schema.Struct(fields)`. Fails
 * with a {@link RouterParamsError} (`source: "path"`) when no route is matched or
 * a requested key is missing / invalid. Re-exported as `Router.params`.
 */
function readParams<F extends Fields>(
  fields: F,
): Effect.Effect<FieldsType<F>, RouterParamsError, Router> {
  return Effect.gen(function* () {
    const router = yield* Router;
    const match = yield* router.currentMatch.get;
    const keys = Object.keys(fields);
    if (match._tag === "NotFound") {
      return yield* Effect.fail(new RouterParamsError({ source: "path", keys }));
    }
    const result = Schema.validateEither(Schema.Struct(fields))(pick(fields, match.path));
    if (Either.isLeft(result)) {
      return yield* Effect.fail(new RouterParamsError({ source: "path", keys }));
    }
    // `validateEither` widens to a homomorphic mapped type; it is `FieldsType<F>`.
    return result.right as FieldsType<F>;
  });
}

/**
 * Reads the live match's **query** for the requested `fields`. Same snapshot +
 * validation semantics as {@link readParams}, failing with a
 * {@link RouterParamsError} (`source: "query"`). Re-exported as `Router.query`.
 */
function readQuery<F extends Fields>(
  fields: F,
): Effect.Effect<FieldsType<F>, RouterParamsError, Router> {
  return Effect.gen(function* () {
    const router = yield* Router;
    const match = yield* router.currentMatch.get;
    const keys = Object.keys(fields);
    if (match._tag === "NotFound") {
      return yield* Effect.fail(new RouterParamsError({ source: "query", keys }));
    }
    const result = Schema.validateEither(Schema.Struct(fields))(pick(fields, match.query));
    if (Either.isLeft(result)) {
      return yield* Effect.fail(new RouterParamsError({ source: "query", keys }));
    }
    // `validateEither` widens to a homomorphic mapped type; it is `FieldsType<F>`.
    return result.right as FieldsType<F>;
  });
}

// oxlint-disable-next-line no-namespace -- declaration merge: authoring combinators on the Router Tag
export namespace Router {
  /** Declares a leaf page. See {@link makeRoute}. */
  export const route = makeRoute;
  /** Declares a layout wrapping an injected outlet. See {@link makeLayout}. */
  export const layout = makeLayout;
  /** Seals a route tree into a `RouterDef`. See {@link makeRouter}. */
  export const router = makeRouter;
  /** The injected outlet service value (yieldable Tag). See {@link OutletTag}. */
  export const Outlet = OutletTag;
  /** The injected outlet service identity (for `Exclude<R, Router.Outlet>`). */
  export type Outlet = OutletTag;
  /** Reads the live match's path params for the requested fields. See {@link readParams}. */
  export const params = readParams;
  /** Reads the live match's query for the requested fields. See {@link readQuery}. */
  export const query = readQuery;
}
