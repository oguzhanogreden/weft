/**
 * Client entry for the noai example. Mounts `App` with the live WebSocket
 * transport. Kept thin and side-effectful so `app.ts` stays importable by tests
 * (see `src/specs.md`, Layout).
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect, Exit } from "effect";
import { App } from "./app";
import { DialogueTransportLive } from "./transport-live";
import { makeScriptedTransport } from "./transport-scripted";

/**
 * Meta tag naming which transport to use, written by the server because only it
 * can see whether a credential resolved. Duplicated rather than shared: a
 * constant for it would widen this example's approved API surface. The other
 * half of the pair is in `server/server.ts`, which writes it.
 */
const DIALOGUE_MODE_META = "noai-dialogue-mode";

/**
 * Live unless the server said otherwise, so opening `index.html` through plain
 * Vite (no dialogue server) still gets a working page.
 */
const chosenTransport = () => {
  const declared = document
    .querySelector(`meta[name="${DIALOGUE_MODE_META}"]`)
    ?.getAttribute("content");
  return declared === "scripted" ? makeScriptedTransport().layer : DialogueTransportLive;
};

/** Mount `App` into `#root` with the live transport. */
export const start = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    const root = document.getElementById("root");
    if (root === null) {
      return;
    }
    // `exit` rather than letting the failure escape: `start` is the outermost
    // edge, so there is nobody left to hand an error to. Reported, not swallowed.
    const outcome = yield* Effect.exit(WeftApp.mount(WeftApp.make(chosenTransport()), App(), root));
    if (Exit.isFailure(outcome)) {
      console.error("noai failed to mount", outcome.cause);
    }
  });

void Effect.runPromise(start());
