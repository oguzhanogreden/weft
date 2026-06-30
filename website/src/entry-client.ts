/**
 * Client entry: hydrates the server-rendered markup in `#root`.
 *
 * `RouterApp(App)` is the universal router root; `RouterLive(App)` provides the
 * History-API-backed `Router` (seeded from `window.location`, with the same-origin
 * link click interceptor installed). `hydrate` adopts the server DOM in place and
 * resumes the reactive outlet, after which back/forward and in-app link clicks
 * navigate without a full page load. No `rpc` option — the app has no `Boundary.rpc`.
 */

import { hydrate } from "@weftui/dom/client";
import { RouterApp, RouterLive } from "@weftui/router/client";
import { ManagedRuntime } from "effect";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

// `RouterLive` is a scoped layer (it owns the popstate listener + link click
// interceptor), so it must outlive `hydrate`. A `ManagedRuntime` keeps it alive
// for the page's lifetime; `hydrate` captures the `Router` service from it.
const runtime = ManagedRuntime.make(RouterLive(App));
void runtime.runPromise(hydrate(RouterApp(App), root));
