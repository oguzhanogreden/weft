/**
 * The shared, isomorphic router app for the `router-ssr` example.
 *
 * `app.ts` is side-effect-free: it exports the sealed {@link App} `RouterDef`
 * (and the leaf routes used to build type-safe `href`s) but never mounts or
 * serves. The server (`entry-server.ts`) renders the matched route to hydratable
 * HTML; the browser (`entry-client.ts`) hydrates `RouterApp(App)` over it and
 * takes over navigation via the History API.
 *
 * The tree is a root `Shell` layout wrapping a `/users/:id` layout, which in turn
 * wraps `/users/:id/settings` and `/users/:id/posts` pages. Every slot is a
 * `component` thunk (`Component.make` / `Component.gen`) the router invokes at
 * render time; outlet and params arrive by dependency injection (layouts splice
 * `yield* Router.Outlet`, components read `yield* Router.params/query`). The
 * `/users/:id` layout owns a `SubscriptionRef` counter so navigation between
 * `settings` and `posts` demonstrably **persists** the layout (the counter keeps
 * its value while only the inner outlet swaps).
 */

import { Component, h } from "@effect-ui/core";
import { href, Router } from "@effect-ui/router";
import { Schema, SubscriptionRef } from "effect";

/** Shared path-param schema: `:id` decodes from its string segment to a number. */
const idParam = { id: Schema.NumberFromString };

/** Optional `?sort=` query field, exercised by the posts page. */
const sortQuery = { sort: Schema.optional(Schema.String) };

/** `/users/:id/settings` — a leaf page reading its `:id` via `Router.params`. */
export const settingsRoute = Router.route("users/:id/settings", {
  path: idParam,
  component: Component.gen(function* () {
    const { id } = yield* Router.params(idParam);
    return yield* h.section({ id: "page" }, [h.h2({}, `Settings page for user ${id}`)]);
  }),
});

/** `/users/:id/posts` — a leaf page reading `:id` and the optional `?sort=` query. */
export const postsRoute = Router.route("users/:id/posts", {
  path: idParam,
  query: sortQuery,
  component: Component.gen(function* () {
    const { id } = yield* Router.params(idParam);
    const { sort } = yield* Router.query(sortQuery);
    return yield* h.section({ id: "page" }, [
      h.h2({}, `Posts page for user ${id}`),
      h.p({ id: "sort" }, `sort: ${sort ?? "none"}`),
    ]);
  }),
});

/**
 * `/` — the home page, with links into a couple of user sections. `Component.make`
 * keeps the body (and its `href` calls) deferred until the router renders it —
 * after `Router.router` has compiled the tree.
 */
export const homeRoute = Router.route("", {
  component: Component.make(() =>
    h.section({ id: "page" }, [
      h.h2({}, "Home page"),
      h.nav({}, [
        h.a({ href: href(settingsRoute, { path: { id: 1 } }) }, "Open user 1"),
        " · ",
        h.a({ href: href(settingsRoute, { path: { id: 2 } }) }, "Open user 2"),
      ]),
    ]),
  ),
});

/** App-level not-found page (HTTP 404 on the server). */
const NotFound = () => h.section({ id: "page" }, [h.h2({}, "404 — page not found")]);

/**
 * The sealed router definition. The whole tree is authored with the namespaced
 * `Router.*` combinators; every slot is a `component` thunk, and outlet + params
 * arrive by dependency injection, so the layouts read like ordinary components and
 * never see a `Node<any, any>`.
 */
export const App = Router.router(
  Router.layout(
    {
      // The root `Shell`: a persistent header/nav around every page.
      component: Component.gen(function* () {
        const outlet = yield* Router.Outlet;
        return yield* h.div({ id: "app" }, [
          h.header({}, [h.strong({}, "router-ssr"), h.nav({}, [h.a({ href: "/" }, "Home")])]),
          h.main({}, [outlet]),
        ]);
      }),
    },
    [
      homeRoute,
      Router.layout(
        {
          // `/users/:id` layout. Owns a per-mount counter to prove persistence,
          // shows the user id (read via `Router.params`), and links to its
          // `settings` / `posts` children. The outlet is injected via `Router.Outlet`.
          component: Component.gen(function* () {
            const { id } = yield* Router.params(idParam);
            const outlet = yield* Router.Outlet;
            const count = yield* SubscriptionRef.make(0);
            return yield* h.div({ "data-user-layout": "" }, [
              h.h1({}, `User ${id}`),
              h.p({}, [
                h.button(
                  {
                    type: "button",
                    id: "bump",
                    onclick: () => SubscriptionRef.update(count, (n) => n + 1),
                  },
                  "bump",
                ),
                " visits to this layout: ",
                h.span({ id: "count" }, [count.changes]),
              ]),
              h.nav({}, [
                h.a({ href: href(settingsRoute, { path: { id } }) }, "Settings"),
                " · ",
                h.a({ href: href(postsRoute, { path: { id } }) }, "Posts"),
              ]),
              outlet,
            ]);
          }),
        },
        [settingsRoute, postsRoute],
      ),
    ],
  ),
  { notFound: NotFound },
);
