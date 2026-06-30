import { Router } from "@weftui/router";
import { Component, h } from "@weftui/core";

export const Home = Router.route("", {
  component: Component.make(() => h.h1("Home")),
});
