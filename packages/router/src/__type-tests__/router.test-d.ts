import { h } from "@effect-ui/core";
import type { Node } from "@effect-ui/core";
import { Context, Effect, Schema } from "effect";
import { href, Router, RouterApp } from "~/index";

// ── Page component args are typed from the route's own path/query schemas ──────

const userRoute = Router.route("users/:id", {
  path: { id: Schema.NumberFromString },
  query: { tab: Schema.optional(Schema.String) },
  component: ({ path, query }) => {
    // Should compile — `path.id` is a number, `query.tab` is `string | undefined`.
    const _id: number = path.id;
    const _tab: string | undefined = query.tab;
    return h.div({}, `${_id}${_tab ?? ""}`);
  },
});

const aboutRoute = Router.route("about", { component: () => h.div({}, "about") });

Router.route("users/:id", {
  path: { id: Schema.NumberFromString },
  component: ({ path }) => {
    // @ts-expect-error — `path.id` is a number, not a string.
    const _wrong: string = path.id;
    return h.div({}, _wrong);
  },
});

// ── Layout outlet is a fully-typed Node, not Node<any, any> ───────────────────

const shell = Router.layout("", { render: ({ outlet }) => h.div({ class: "shell" }, [outlet]) }, [
  userRoute,
  aboutRoute,
]);

Router.layout(
  "",
  // @ts-expect-error — `outlet` is a Node value, not a function to call.
  { render: ({ outlet }) => h.div({}, [outlet()]) },
  [aboutRoute],
);

Router.router(shell, { notFound: () => h.h1({}, "404") });

// ── Channel propagation: the sealed app surfaces a precise Node type ──────────

// A fully-static tree's app needs only the universal `Router` service and can
// raise nothing (the internal boundary catches `RouterNotFound`).
const _staticApp: Node<never, Router> = RouterApp(
  Router.router(
    Router.layout("", { render: ({ outlet }) => h.div({}, [outlet]) }, [
      Router.route("", { component: () => h.div({}, "home") }),
    ]),
    { notFound: () => h.div({}, "404") },
  ),
);

// A page requirement flows all the way up into the app node's `R`.
class Theme extends Context.Tag("@test/Theme")<Theme, string>() {}

const _themedApp: Node<never, Theme | Router> = RouterApp(
  Router.router(
    Router.layout("", { render: ({ outlet }) => h.div({}, [outlet]) }, [
      Router.route("themed", { component: () => h.div({}, [Effect.map(Theme, (c) => c)]) }),
    ]),
    { notFound: () => h.div({}, "404") },
  ),
);

// ── href argument requiredness (H1/H4) ────────────────────────────────────────

// Should compile — path required, query optional.
href(userRoute, { path: { id: 1 } });
href(userRoute, { path: { id: 1 }, query: { tab: "x" } });

// Should compile — a no-param/no-query route needs no argument.
href(aboutRoute);

// @ts-expect-error — path is required when the route has path params.
href(userRoute, {});

// @ts-expect-error — `id` must be a number.
href(userRoute, { path: { id: "not-a-number" } });

// @ts-expect-error — unknown query key.
href(userRoute, { path: { id: 1 }, query: { nope: "x" } });
