/**
 * Browser entry: mounts the Server Boundary example into `#root`.
 *
 * The `AppRpcClientTag` seam is provided at the mount call site (not inside `App`),
 * because the renderer drains the boundary's forked rpc call in the mount's context.
 * Kept separate from `app.ts` so the latter stays importable by the browser test.
 */

import { mount } from "@weftui/dom/client";
import { Effect } from "effect";
import { App, AppRpcClientLive } from "./app";

void Effect.runPromise(
  Effect.provide(mount(App(), document.getElementById("root")!), AppRpcClientLive),
);
