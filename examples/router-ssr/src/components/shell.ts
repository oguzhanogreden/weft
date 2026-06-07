/**
 * `Shell` — the root layout wrapping every page.
 *
 * It renders the persistent shop chrome (header with brand + nav, footer) and
 * splices the active page via `yield* Router.Outlet`. As the outermost layout it
 * never re-renders across navigations, so its DOM node is stable for the whole
 * session — the navigation test asserts this directly. The nav uses
 * `href(productsRoute)` (no args — its query is optional) for a type-safe link.
 */

import { Component, h } from "@effect-ui/core";
import { href, Router } from "@effect-ui/router";
import { productsRoute } from "../pages/listing";

/** The persistent header/nav/footer chrome around the routed outlet. */
export const Shell = Component.gen(function* () {
  const outlet = yield* Router.Outlet;
  return yield* h.div({ id: "app" }, [
    h.header({ id: "shell-header" }, [
      h.strong("effect-ui shop"),
      h.nav([h.a({ href: "/" }, "Home"), " · ", h.a({ href: href(productsRoute) }, "Products")]),
    ]),
    h.main([outlet]),
    h.footer("built with @effect-ui/router — SSR + hydration"),
  ]);
});
