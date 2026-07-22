/**
 * Browser entry: mounts the client-only router app into `#root`.
 *
 * `RouterLive(App)` provides the History-API-backed `Router` (seeded from
 * `window.location`, with the same-origin link click interceptor installed).
 * No rpc option: this app has no `Boundary.rpc`. Kept separate from `app.ts`
 * so the latter stays side-effect-free for the browser test.
 */

import { WeftApp } from "@weftui/dom/client";
import { RouterApp, RouterLive } from "@weftui/router/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

const app = WeftApp.make(RouterLive(App));
void Effect.runPromise(WeftApp.mount(app, RouterApp(App), root));
