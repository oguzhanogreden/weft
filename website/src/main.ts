import { Router } from "@weftui/router";
import { DocumentShell } from "./layouts/shell";
import { Component, h } from "@weftui/core";
import { RouterServer } from "@weftui/router/server";

export const App = Router.router(
  Router.layout(
    {
      component: Component.gen(function* () {
        return yield* yield* Router.Outlet;
      }),
    },
    [],
  ),
  {
    notFound: () => h.section([h.h2("404 — page not found")]),
  },
);

export const handler = RouterServer.toWebHandler(App, { document: DocumentShell });
