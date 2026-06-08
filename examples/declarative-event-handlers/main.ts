/**
 * Browser entry: mounts the Declarative Event Handlers example into `#root`.
 *
 * Kept separate from `app.ts` so the latter stays a side-effect-free module that
 * tests can import and mount into their own container (see `app.browser.test.ts`).
 * The `Analytics` service the tracked-button handler depends on is provided here.
 */

import { mount } from "@weftui/dom/client";
import { Effect } from "effect";
import { AnalyticsLive, App } from "./app";

void Effect.runPromise(
  mount(App(), document.getElementById("root")!).pipe(Effect.provide(AnalyticsLive)),
);
