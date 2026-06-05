import { Component, h } from "@effect-ui/core";
import type { Node } from "@effect-ui/core";
import { Context, Effect, Schema } from "effect";
import { href, Router, RouterApp, RouterParamsError } from "~/index";

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
