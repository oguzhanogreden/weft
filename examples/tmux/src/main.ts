/**
 * Browser entry: mounts the tmux example with the real WebSocket transport.
 *
 * Kept separate from `app.ts` so the latter stays side-effect-free and testable
 * with a mock transport. Start the PTY backend first (see `readme.md`).
 *
 * The query string (`?cols=200&rows=50`) seeds the _initial_ grid size, and is
 * the only way to reach a non-preset size. The control bar's size buttons drive
 * it from there and mirror the choice back, so a reload keeps what you were
 * benchmarking.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";
import { DEFAULT_GRID_SIZE, parseGridSize } from "./grid-size";
import { PtyTransportWebSocketLive } from "./transport-ws";

const size = parseGridSize(window.location.search, DEFAULT_GRID_SIZE);

const app = WeftApp.make(PtyTransportWebSocketLive);
void Effect.runPromise(WeftApp.mount(app, App(size), document.getElementById("root")!));
