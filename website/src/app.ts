/**
 * Universal app definition — side-effect-free.
 *
 * Exports the `Router` def consumed by both entries: `entry-server.ts` renders it
 * to a hydratable HTML document, `entry-client.ts` hydrates and takes over
 * navigation. No `mount`/`hydrate`/`handler` here, so the module is importable by
 * tests and by both build targets without running anything.
 *
 * Route tree: a passthrough root layout holds the landing page (full-width, no
 * sidebar) alongside the `DocsShell` layout, which wraps the doc routes so the
 * chrome persists across doc-to-doc navigation. Every section — tutorial, how-to,
 * explanation, reference — routes uniformly through `/docs/:category/:slug`.
 */

import { Component, h } from "@weftui/core";
import { Router } from "@weftui/router";
import { DocsShell } from "./layouts/docs-shell";
import { docsIndexRoute, docsRoute } from "./routes/docs";
import { Home } from "./routes/home";
import "./app.css";

/** A passthrough layout that renders the injected outlet directly (no chrome). */
const RootLayout = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  return yield* outlet;
});

export const App = Router.router(
  Router.layout({ component: RootLayout }, [
    Home,
    Router.layout({ component: DocsShell }, [docsIndexRoute, docsRoute]),
  ]),
  {
    notFound: () =>
      h.section({ class: "mx-auto max-w-4xl px-5 py-24 text-center" }, [
        h.h2({ class: "mb-4 text-2xl font-semibold" }, "404 — page not found"),
        h.p([h.a({ href: "/", class: "text-indigo-11 no-underline" }, "Go home")]),
      ]),
  },
);
