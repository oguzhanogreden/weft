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
import type { Node } from "@effect-ui/core";
import { href, layout, route, router } from "@effect-ui/router";
import { Effect, Schema, SubscriptionRef } from "effect";

/** Shared path-param schema: `:id` decodes from its string segment to a number. */
const idParam = { id: Schema.NumberFromString };

/** `/users/:id/settings` — a leaf page. */
export const settingsRoute = route("settings", { path: idParam }, () =>
  h.section({ id: "page" }, [h.h2({}, "Settings page")]),
);

/** `/users/:id/posts` — a leaf page. */
export const postsRoute = route("posts", { path: idParam }, () =>
  h.section({ id: "page" }, [h.h2({}, "Posts page")]),
);

/** `/` — the home page, with links into a couple of user sections. */
export const homeRoute = route("", () =>
  h.section({ id: "page" }, [
    h.h2({}, "Home page"),
    h.nav({}, [
      h.a({ href: href(settingsRoute, { path: { id: 1 } }) }, "Open user 1"),
      " · ",
      h.a({ href: href(settingsRoute, { path: { id: 2 } }) }, "Open user 2"),
    ]),
  ]),
);

/**
 * `/users/:id` layout. Owns a per-mount counter to prove persistence, shows the
 * user id, and links to its `settings` / `posts` children. The `outlet` is the
 * next level down (the matched leaf page).
 */
const UserLayout = (outlet: Node<any, any>, args: { path: { id: number } }) =>
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    return yield* h.div({ "data-user-layout": "" }, [
      h.h1({}, `User ${args.path.id}`),
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
        h.a({ href: href(settingsRoute, { path: { id: args.path.id } }) }, "Settings"),
        " · ",
        h.a({ href: href(postsRoute, { path: { id: args.path.id } }) }, "Posts"),
      ]),
      outlet,
    ]);
  });

/** App-level not-found page (HTTP 404 on the server). */
const NotFound = () => h.section({ id: "page" }, [h.h2({}, "404 — page not found")]);

/**
 * The root `Shell` layout: a persistent header/nav around every page, plus the
 * top-level outlet.
 */
const Shell = (outlet: Node<any, any>) =>
  h.div({ id: "app" }, [
    h.header({}, [h.strong({}, "router-ssr"), h.nav({}, [h.a({ href: "/" }, "Home")])]),
    h.main({}, [outlet]),
  ]);

/** The sealed router definition. */
export const App = router(
  layout("", Shell, [
    homeRoute,
    layout("users/:id", { path: idParam }, UserLayout, [settingsRoute, postsRoute]),
  ]),
  { notFound: NotFound },
);
