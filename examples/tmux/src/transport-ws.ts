/**
 * Real `PtyTransport` over a WebSocket to the `server/` PTY backend. Ships in the
 * app (see `main.ts`); the browser test uses the mock layer instead.
 *
 * The socket's `message` events become an Effect `Stream` via `Stream.fromEventListener`
 * (the same primitive `examples/headless-menu` uses for document listeners). The
 * session is `Scope`-bound: an unmounted pane runs the finalizer and closes the
 * socket, so the backend kills the shell.
 *
 * Not exercised by CI (no `node-pty` in the browser suite); validate manually
 * against a running backend per `readme.md`.
 */

import { Effect, Layer, Scope, Stream } from "effect";
import { type PaneSession, PtyTransport, type SpawnOptions, TransportError } from "./transport";

const DEFAULT_URL = "ws://localhost:8787";

const openSocket = (url: string): Effect.Effect<WebSocket, TransportError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<WebSocket, TransportError>((resume) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.addEventListener("open", () => resume(Effect.succeed(ws)), { once: true });
      ws.addEventListener(
        "error",
        () => resume(Effect.fail(new TransportError({ reason: `failed to open ${url}` }))),
        { once: true },
      );
    }),
    (ws) => Effect.sync(() => ws.close()),
  );

const spawn = (options: SpawnOptions): Effect.Effect<PaneSession, TransportError, Scope.Scope> =>
  Effect.gen(function* () {
    const base = (globalThis as { __TMUX_WS_URL__?: string }).__TMUX_WS_URL__ ?? DEFAULT_URL;
    const ws = yield* openSocket(`${base}?cols=${options.cols}&rows=${options.rows}`);

    const output = Stream.fromEventListener<MessageEvent>(ws, "message").pipe(
      Stream.map((event) => new Uint8Array(event.data as ArrayBuffer)),
    );
    const send = (message: object) => Effect.sync(() => ws.send(JSON.stringify(message)));

    return {
      output,
      write: (data) => send({ type: "input", data }),
      resize: (cols, rows) => send({ type: "resize", cols, rows }),
    } satisfies PaneSession;
  });

/** Real WebSocket-backed transport. Reads `globalThis.__TMUX_WS_URL__`, else `ws://localhost:8787`. */
export const PtyTransportWebSocketLive = Layer.succeed(PtyTransport, { spawn });
