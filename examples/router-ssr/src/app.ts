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
 * wraps `/users/:id/settings` and `/users/:id/posts` pages. The `/users/:id`
 * layout owns a `SubscriptionRef` counter so navigation between `settings` and
 * `posts` demonstrably **persists** the layout (the counter keeps its value while
 * only the inner outlet swaps).
 */

import { h } from "@effect-ui/core";
import { href, Router } from "@effect-ui/router";
import { Effect, Schema, SubscriptionRef } from "effect";

/** Shared path-param schema: `:id` decodes from its string segment to a number. */
const idParam = { id: Schema.NumberFromString };

/** `/users/:id/settings` — a leaf page. */
export const settingsRoute = Router.route("settings", {
  path: idParam,
  component: () => h.section({ id: "page" }, [h.h2({}, "Settings page")]),
});

/** `/users/:id/posts` — a leaf page. */
export const postsRoute = Router.route("posts", {
  path: idParam,
  component: () => h.section({ id: "page" }, [h.h2({}, "Posts page")]),
});

/** `/` — the home page, with links into a couple of user sections. */
export const homeRoute = Router.route("", {
  component: () =>
    h.section({ id: "page" }, [
      h.h2({}, "Home page"),
      h.nav({}, [
        h.a({ href: href(settingsRoute, { path: { id: 1 } }) }, "Open user 1"),
        " · ",
        h.a({ href: href(settingsRoute, { path: { id: 2 } }) }, "Open user 2"),
      ]),
    ]),
});

/** App-level not-found page (HTTP 404 on the server). */
const NotFound = () => h.section({ id: "page" }, [h.h2({}, "404 — page not found")]);

/**
 * The sealed router definition. The whole tree is authored with the namespaced
 * `Router.*` combinators; every `outlet` is a fully-typed `Node`, so the layouts
 * read like ordinary components.
 */
export const App = Router.router(
  Router.layout(
    "",
    {
      // The root `Shell`: a persistent header/nav around every page.
      render: ({ outlet }) =>
        h.div({ id: "app" }, [
          h.header({}, [h.strong({}, "router-ssr"), h.nav({}, [h.a({ href: "/" }, "Home")])]),
          h.main({}, [outlet]),
        ]),
    },
    [
      homeRoute,
      Router.layout(
        "users/:id",
        {
          path: idParam,
          // `/users/:id` layout. Owns a per-mount counter to prove persistence,
          // shows the user id, and links to its `settings` / `posts` children.
          render: ({ path, outlet }) =>
            Effect.gen(function* () {
              const count = yield* SubscriptionRef.make(0);
              return yield* h.div({ "data-user-layout": "" }, [
                h.h1({}, `User ${path.id}`),
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
                  h.a({ href: href(settingsRoute, { path: { id: path.id } }) }, "Settings"),
                  " · ",
                  h.a({ href: href(postsRoute, { path: { id: path.id } }) }, "Posts"),
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
