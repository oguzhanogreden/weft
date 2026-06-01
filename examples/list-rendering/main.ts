/**
 * Browser entry: mounts the List Rendering example into `#root`.
 *
 * Kept separate from `app.ts` so the latter stays a side-effect-free module that
 * tests can import and mount into their own container (see `app.browser.test.ts`).
 */

import { mount } from "@effect-ui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

void Effect.runPromise(mount(App(), document.getElementById("root")!));
