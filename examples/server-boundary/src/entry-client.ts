/**
 * Client entry: hydrates the server-rendered markup in `#root`.
 *
 * Note there is **no** `Database` (nor any other server-only service) in scope
 * here: `hydrate(App(), root)` type-checks and runs because the boundary's
 * `load` was discharged on the server. `hydrate` decodes the inline product
 * payload and resumes the page — it never runs `load`. Once it resolves we flip
 * the status indicator so the SSR → hydrated transition is visible.
 */

import { hydrate } from "@effect-ui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

void Effect.runPromise(hydrate(App(), root)).then(() => {
  const status = document.getElementById("status");
  if (status !== null) {
    status.textContent = "[hydrated — interactive]";
  }
});
