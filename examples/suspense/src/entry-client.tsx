/**
 * Client entry: hydrates the server-rendered markup in `#root`.
 *
 * By the time this script runs, the SSR patch scripts have already executed —
 * each `<Suspense>` boundary is fully resolved in the DOM. `hydrate` adopts the
 * resolved structure in place, attaches event handlers and reactive subscriptions,
 * and leaves node identity unchanged (no flash).
 */

import { hydrate } from "@effect-ui/dom";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

void Effect.runPromise(hydrate(<App />, root)).then(() => {
  const status = document.getElementById("status");
  if (status !== null) {
    status.textContent = "[hydrated — interactive]";
  }
});
