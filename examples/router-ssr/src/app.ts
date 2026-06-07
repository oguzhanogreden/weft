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
 * wraps `/users/:id/settings` and `/users/:id/posts` pages. It exercises **both**
 * ways a node reads the live match:
 *
 * - **Leaf pages** (`settings` / `posts`) take **handler-arg props** — the router
 *   passes the decoded `{ path, query }` (`RouteHandlerProps`) straight into the
 *   `component`, so the page reads `path.id` / `query.sort` as ordinary props.
 * - **The `/users/:id` layout** can't take handler args (it sits above the leaf),
 *   so it keeps **dependency injection**: `yield* Router.params` for `:id`, and
 *   `yield* Router.Outlet` for the next level down.
 *
 * The `/users/:id` layout owns a `SubscriptionRef` counter so navigation between
 * `settings` and `posts` demonstrably **persists** the layout (the counter keeps
 * its value while only the inner outlet swaps).
 *
 * `/dashboard` adds a **`Boundary.server` with client refetch**: its data is
 * loaded server-side (from a server-only `Metrics` service), rendered inline for
 * SSR, and a "Refresh" button re-fetches through the router's `GET /_eui/data`
 * endpoint — re-running `load` on the server and patching the region in place
 * after hydration, without ever running `load` in the browser.
 */

import { Boundary, Component, h, ServerTag } from "@effect-ui/core";
import { href, Router } from "@effect-ui/router";
import { Effect, Layer, Schema, Stream, SubscriptionRef } from "effect";

/** Shared path-param schema: `:id` decodes from its string segment to a number. */
const idParam = { id: Schema.NumberFromString };

/** Optional `?sort=` query field, exercised by the posts page. */
const sortQuery = { sort: Schema.optional(Schema.String) };

/**
 * Server-only metrics source for the `/dashboard` `Boundary.server`. Branded via
 * {@link ServerTag} so it can only be read inside the boundary's `load` (never in
 * universal `render`/`hydrate` code); discharged on the server by `provide`.
 */
class Metrics extends ServerTag("Metrics")<
  Metrics,
  { readonly next: () => Effect.Effect<{ readonly value: number }> }
>() {}

/**
 * Monotonic counter behind {@link Metrics}. Module-level so a refetch (which
 * re-runs `load` on the **server** through `GET /_eui/data`) returns a strictly
 * larger value than the SSR snapshot — making the in-place patch observable.
 */
let serverTick = 0;

/** Live {@link Metrics}, provided only on the server through the boundary's `provide`. */
const MetricsLive = Layer.succeed(Metrics, {
  next: () => Effect.sync(() => ({ value: ++serverTick })),
});

/** Wire contract for the dashboard metric: encoded to JSON on the server, decoded on the client. */
const Metric = Schema.Struct({ value: Schema.Number });

/**
 * `/dashboard` — a `Boundary.server` whose data is loaded server-side and can be
 * **refetched** after hydration. The SSR snapshot is rendered inline; a "Refresh"
 * button calls `resource.refetch`, which hits the router's `GET /_eui/data`
 * endpoint (re-running `load` on the server), decodes the envelope, and patches
 * the `#metric` region **in place** — no remount, no flash.
 */
export const dashboardRoute = Router.route("dashboard", {
  component: Component.make(() =>
    Boundary.server(
      {
        id: "dashboard-metrics",
        load: () => Effect.flatMap(Metrics, (m) => m.next()),
        provide: MetricsLive,
        schema: Metric,
      },
      (resource) =>
        h.section({ id: "page", class: "dashboard" }, [
          h.h2("Dashboard"),
          h.p([
            "metric: ",
            h.span({ id: "metric" }, [Stream.map(resource.value.changes, (d) => String(d.value))]),
          ]),
          h.p([
            "refreshing: ",
            h.span({ id: "pending" }, [
              Stream.map(resource.pending.changes, (p) => (p ? "yes" : "no")),
            ]),
          ]),
          h.button({ type: "button", id: "refresh", onclick: () => resource.refetch }, "Refresh"),
        ]),
    ),
  ),
});

/**
 * `/users/:id/settings` — a leaf page using **handler-arg props**: the router
 * passes the decoded `{ path }` straight in, so `path.id` is already a `number`.
 */
export const settingsRoute = Router.route("users/:id/settings", {
  path: idParam,
  component: ({ path }) => h.section({ id: "page" }, [h.h2(`Settings page for user ${path.id}`)]),
});

/**
 * `/users/:id/posts` — a leaf page reading both decoded `{ path, query }` from its
 * handler-arg props (no `Router.params` / `Router.query` DI needed at a leaf).
 */
export const postsRoute = Router.route("users/:id/posts", {
  path: idParam,
  query: sortQuery,
  component: ({ path, query }) =>
    h.section({ id: "page" }, [
      h.h2(`Posts page for user ${path.id}`),
      h.p({ id: "sort" }, `sort: ${query.sort ?? "none"}`),
    ]),
});

/**
 * `/` — the home page, with links into a couple of user sections. `Component.make`
 * keeps the body (and its `href` calls) deferred until the router renders it —
 * after `Router.router` has compiled the tree.
 */
export const homeRoute = Router.route("", {
  component: Component.make(() =>
    h.section({ id: "page" }, [
      h.h2("Home page"),
      h.nav([
        h.a({ href: href(settingsRoute, { path: { id: 1 } }) }, "Open user 1"),
        " · ",
        h.a({ href: href(settingsRoute, { path: { id: 2 } }) }, "Open user 2"),
      ]),
    ]),
  ),
});

/** App-level not-found page (HTTP 404 on the server). */
const NotFound = () => h.section({ id: "page" }, [h.h2("404 — page not found")]);

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
          h.header([h.strong("router-ssr"), h.nav([h.a({ href: "/" }, "Home")])]),
          h.main([outlet]),
        ]);
      }),
    },
    [
      homeRoute,
      dashboardRoute,
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
              h.h1(`User ${id}`),
              h.p([
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
              h.nav([
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
