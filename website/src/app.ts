/**
 * Universal app definition — side-effect-free.
 *
 * Exports the `Router` def consumed by both entries: `entry-server.ts` renders it
 * to a hydratable HTML document, `entry-client.ts` hydrates and takes over
 * navigation. No `mount`/`hydrate`/`handler` here, so the module is importable by
 * tests and by both build targets without running anything.
 */

import { Component, h } from "@weftui/core";
import { Router } from "@weftui/router";
import { Home } from "./routes/home";
import "./app.css";

export const App = Router.router(
  Router.layout(
    {
      component: Component.gen(function* () {
        return yield* yield* Router.Outlet;
      }),
    },
    [Home],
  ),
  {
    notFound: () => h.section([h.h2("404 — page not found")]),
  },
);
