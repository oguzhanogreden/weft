/**
 * tmux example: a browser terminal multiplexer on Weft (real PTY over WebSocket).
 *
 * Side-effect-free: exports `App` (no top-level mount) so tests can mount it with
 * a mock transport. `App` depends on the `PtyTransport` service; the concrete
 * layer is chosen by the entry point (`main.ts` = WebSocket, tests = mock).
 *
 * This is the single-terminal milestone (plan Phase 2). Multiplexing (panes,
 * windows, prefix keybindings) and the perf render-mode switch build on it.
 */

import type { Node } from "@weftui/core";
import { Effect, type Scope } from "effect";
import { Terminal } from "./terminal";
import { PtyTransport, type TransportError } from "./transport";

/** The application root: spawn one shell and render it as a terminal pane. */
export const App = (): Node<TransportError, PtyTransport | Scope.Scope> =>
  Effect.gen(function* () {
    const transport = yield* PtyTransport;
    const session = yield* transport.spawn({ cols: 80, rows: 24 });
    return yield* Terminal(session, { cols: 80, rows: 24 });
  });
