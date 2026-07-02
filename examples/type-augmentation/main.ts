/**
 * Browser entry: mounts the Type Augmentation example into `#root`.
 *
 * Kept separate from `app.ts` so the latter stays a side-effect-free module the
 * browser test can import and mount into its own container.
 */

import { mount } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

void Effect.runPromise(mount(App(), document.getElementById("root")!));
