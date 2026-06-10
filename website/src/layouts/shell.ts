import { Component, h } from "@weftui/core";
import { Router } from "@weftui/router";

export const DocumentShell = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  return yield* h.html({ lang: "en" }, [
    h.head([h.meta({ charset: "utf-8" }), h.title("Weft")]),
    h.body([h.main({ id: "root" }, [outlet])]),
  ]);
});
