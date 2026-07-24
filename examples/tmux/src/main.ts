/**
 * Browser entry: mounts the tmux example with the real WebSocket transport.
 *
 * Kept separate from `app.ts` so the latter stays side-effect-free and testable
 * with a mock transport. Start the PTY backend first (see `readme.md`).
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";
import { PtyTransportWebSocketLive } from "./transport-ws";

const app = WeftApp.make(PtyTransportWebSocketLive);
void Effect.runPromise(WeftApp.mount(app, App(), document.getElementById("root")!));
