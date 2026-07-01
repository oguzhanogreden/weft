import { Component, h } from "@weftui/core";
import type { Node } from "@weftui/core";
import { Context, Effect, Layer, Schema } from "effect";
import { navigate, push, replace } from "~/client/navigation";
import { RouterLive } from "~/client/router-live";
import { href, Router, RouterApp, RouterParamsError } from "~/index";
import { RouterServer } from "~/server/router-server";

// ── Router.params / Router.query: typed values + RouterParamsError in E ────────

const idFields = { id: Schema.NumberFromString };
const sortFields = { sort: Schema.optional(Schema.String) };

// Should compile — `params` yields the decoded Type with `RouterParamsError` in E.
const _params: Effect.Effect<{ readonly id: number }, RouterParamsError, Router> =
  Router.params(idFields);
const _queryEff: Effect.Effect<{ readonly sort?: string | undefined }, RouterParamsError, Router> =
  Router.query(sortFields);

// @ts-expect-error — `id` decodes to a number, not a string.
const _wrongParams: Effect.Effect<{ readonly id: string }, RouterParamsError, Router> =
  Router.params(idFields);

// ── Page component is a thunk Node reading the live match's params ─────────────

const userRoute = Router.route("users/:id", {
  path: idFields,
  query: sortFields,
  component: Component.gen(function* () {
    const { id } = yield* Router.params(idFields);
    const { sort } = yield* Router.query(sortFields);
    // Should compile — `id` is a number, `sort` is `string | undefined`.
    const _id: number = id;
    const _sort: string | undefined = sort;
    return yield* h.div({}, `${_id}${_sort ?? ""}`);
  }),
});

// `Component.make` (and a plain thunk) are accepted too.
const aboutRoute = Router.route("about", { component: Component.make(() => h.div({}, "about")) });

Router.route("users/:id", {
  path: idFields,
  component: Component.gen(function* () {
    const { id } = yield* Router.params(idFields);
    // @ts-expect-error — `id` is a number, not a string.
    const _wrong: string = id;
    return yield* h.div({}, `${_wrong}`);
  }),
});

// @ts-expect-error — a bare Node is not accepted; the slot is a thunk `() => Node`.
Router.route("bare", { component: h.div({}, "bare") });

// ── Leaf handler-arg props: decoded { path, query } inferred from the route ────

// The props form: `component` receives `{ path, query }` typed from the route's
// `path`/`query` fields — no annotation needed, the slot param is contextually typed.
const orderRoute = Router.route("orders/:oid", {
  path: { oid: Schema.NumberFromString },
  query: { page: Schema.optional(Schema.NumberFromString) },
  component: ({ path, query }) => {
    // Should compile — `oid` decodes to a number, `page` to `number | undefined`.
    const _oid: number = path.oid;
    const _page: number | undefined = query.page;
    return h.div({}, `${_oid}${_page ?? ""}`);
  },
});

// `href` still works on a props-form route (path required, query optional).
href(orderRoute, { path: { oid: 1 } });
href(orderRoute, { path: { oid: 1 }, query: { page: 2 } });

Router.route("orders/:oid", {
  path: { oid: Schema.NumberFromString },
  component: ({ path }) => {
    // @ts-expect-error — `oid` is a number, not a string.
    const _wrong: string = path.oid;
    return h.div({}, `${_wrong}`);
  },
});

// ── Layout component is a thunk Node that splices the injected Outlet ──────────

const shell = Router.layout(
  {
    component: Component.gen(function* () {
      const outlet = yield* Router.Outlet;
      return yield* h.div({ class: "shell" }, [outlet]);
    }),
  },
  [userRoute, aboutRoute],
);

Router.layout(
  {
    component: Component.gen(function* () {
      const outlet = yield* Router.Outlet;
      // @ts-expect-error — `outlet` is a Node value, not a function to call.
      return yield* h.div({}, [outlet()]);
    }),
  },
  [aboutRoute],
);

// ── Channel propagation: the sealed app surfaces a precise Node type ───────────

// The layout discharges `Outlet` (provided at render), so it never appears in the
// sealed app's `R`; the page's `Router.params`/`query` add `RouterParamsError` to E.
const _app: Node<RouterParamsError, Router> = RouterApp(
  Router.router(shell, { notFound: () => h.h1({}, "404") }),
);

// A fully-static tree's app needs only the universal `Router` service and can
// raise nothing (the internal boundary catches `RouterNotFound`). A plain
// `() => Effect.gen(…)` thunk works as the slot too.
const _staticApp: Node<never, Router> = RouterApp(
  Router.router(
    Router.layout(
      {
        component: () =>
          Effect.gen(function* () {
            const outlet = yield* Router.Outlet;
            return yield* outlet;
          }),
      },
      [Router.route("", { component: Component.make(() => h.div({}, "home")) })],
    ),
    { notFound: () => h.div({}, "404") },
  ),
);

// A page requirement flows all the way up into the app node's `R`.
class Theme extends Context.Tag("@test/Theme")<Theme, string>() {}

const _themedApp: Node<never, Theme | Router> = RouterApp(
  Router.router(
    Router.layout(
      {
        component: Component.gen(function* () {
          const outlet = yield* Router.Outlet;
          return yield* outlet;
        }),
      },
      [
        Router.route("themed", {
          component: Component.gen(function* () {
            const color = yield* Theme;
            return yield* h.div({}, color);
          }),
        }),
      ],
    ),
    { notFound: () => h.div({}, "404") },
  ),
);

// ── href argument requiredness (H1/H4) ────────────────────────────────────────

// Should compile — path required, query optional.
href(userRoute, { path: { id: 1 } });
href(userRoute, { path: { id: 1 }, query: { sort: "x" } });

// Should compile — a no-param/no-query route needs no argument.
href(aboutRoute);

// @ts-expect-error — path is required when the route has path params.
href(userRoute, {});

// @ts-expect-error — `id` must be a number.
href(userRoute, { path: { id: "not-a-number" } });

// @ts-expect-error — unknown query key.
href(userRoute, { path: { id: 1 }, query: { nope: "x" } });

// ── navigate(ref, args) inference (mirrors href requiredness) ──────────────────

// Should compile — typed args, optional trailing NavigateOptions, returns an
// Effect requiring only the `Router` service.
const _nav: Effect.Effect<void, never, Router> = navigate(userRoute, { path: { id: 1 } });
navigate(userRoute, { path: { id: 1 }, query: { sort: "x" } }, { replace: true });

// Should compile — a no-param/no-query route needs no args; options still allowed.
navigate(aboutRoute);
navigate(aboutRoute, undefined, { replace: true });

// @ts-expect-error — path is required when the route has path params.
navigate(userRoute, {});

// @ts-expect-error — `id` must be a number.
navigate(userRoute, { path: { id: "not-a-number" } });

// @ts-expect-error — unknown query key.
navigate(userRoute, { path: { id: 1 }, query: { nope: "x" } });

// push / replace take a raw string and require the `Router` service.
const _push: Effect.Effect<void, never, Router> = push("/about");
const _replace: Effect.Effect<void, never, Router> = replace("/about");

// ── Render-time context seam requiredness (AC2 / AC3) ──────────────────────────

class Other extends Context.Tag("@test/Other")<Other, string>() {}

const themedDoc = Component.make(() => h.div({}, "doc"));

// A def whose leaf requires an app service ⇒ its `R` carries `Theme`.
const themedDef = Router.router(
  Router.layout(
    {
      component: Component.gen(function* () {
        const outlet = yield* Router.Outlet;
        return yield* outlet;
      }),
    },
    [
      Router.route("themed", {
        component: Component.gen(function* () {
          return yield* h.div({}, yield* Theme);
        }),
      }),
    ],
  ),
  { notFound: () => h.div({}, "404") },
);

const ThemeLive = Layer.succeed(Theme, "dark");

// Should compile — `context` supplies the residual `Theme` service (AC2 satisfied).
RouterServer.render(themedDef, { document: themedDoc, url: "/themed", context: ThemeLive });
RouterServer.toWebHandler(themedDef, { document: themedDoc, context: ThemeLive });
RouterServer.toStreamingWebHandler(themedDef, { document: themedDoc, context: ThemeLive });

// @ts-expect-error — `context` is required: the def needs `Theme` (AC2 — missing provide is a compile error).
RouterServer.render(themedDef, { document: themedDoc, url: "/themed" });

const wrongCtx = Layer.succeed(Other, "x");
// @ts-expect-error — the context Layer must supply `Theme`, not an unrelated service.
RouterServer.render(themedDef, { document: themedDoc, url: "/themed", context: wrongCtx });

// Client parity (AC4): `RouterLive` requires the same `context` for a themed def.
RouterLive(themedDef, { context: ThemeLive });

// @ts-expect-error — client seam also requires `context` when the def has app services.
RouterLive(themedDef, {});

// A no-service def: `context` is disallowed, and both seams work with none (AC3).
const staticDef = Router.router(
  Router.layout(
    {
      component: Component.gen(function* () {
        const outlet = yield* Router.Outlet;
        return yield* outlet;
      }),
    },
    [Router.route("", { component: Component.make(() => h.div({}, "home")) })],
  ),
  { notFound: () => h.div({}, "404") },
);

// Should compile — no residual services, so `context` may be omitted.
RouterServer.render(staticDef, { document: themedDoc, url: "/" });
RouterServer.toWebHandler(staticDef, { document: themedDoc });
RouterLive(staticDef);

// @ts-expect-error — a no-service def disallows `context` (nothing to provide).
RouterServer.render(staticDef, { document: themedDoc, url: "/", context: ThemeLive });
