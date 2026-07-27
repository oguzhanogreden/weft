/**
 * PTY transport as an Effect service. The app depends only on this interface,
 * so tests swap `PtyTransportMock` for the real WebSocket layer without touching
 * component code (see `src/specs.md`, AC-TRANSPORT).
 */

import { Context, Data, type Effect, type Option, type Scope, type Stream } from "effect";

/** Initial (and resize) grid dimensions for a spawned shell. */
export interface SpawnOptions {
  readonly cols: number;
  readonly rows: number;
}

/**
 * Connection state for a remote (WebSocket) session. `unauthorized` is terminal:
 * the token was wrong, and no amount of retrying fixes that. `offline` means
 * retries were abandoned and are waiting for a wake signal to re-arm, not that
 * the session is gone (see `src/specs.md`, AC-REMOTE).
 */
export type ConnectionStatus = "connecting" | "live" | "offline" | "unauthorized";

/** A live connection to one shell PTY. Scope-bound: closing the scope kills it. */
export interface PaneSession {
  /** Raw PTY output bytes. One stream across reconnects; a blip does not end it. */
  readonly output: Stream.Stream<Uint8Array>;
  /** Current connection state. Emits on subscribe, so a late subscriber is never blank. */
  readonly status: Stream.Stream<ConnectionStatus>;
  /**
   * A shareable read-only viewer URL, once the backend has sent one. `None` for
   * the life of a viewer's own connection, which never receives it (see
   * `src/specs.md`, AC-STREAM).
   */
  readonly shareUrl: Stream.Stream<Option.Option<string>>;
  /** Send keystrokes to the shell. Dropped, not queued, while not `live`. */
  readonly write: (data: string) => Effect.Effect<void>;
  /** Tell the shell the grid was resized. */
  readonly resize: (cols: number, rows: number) => Effect.Effect<void>;
}

/** Transport failure (socket open/refused, unexpected close). */
export class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: string;
}> {}

/**
 * The transport capability. `spawn` yields a `PaneSession` bound to the calling
 * scope, so an unmounted pane closes its socket and kills its shell.
 */
export class PtyTransport extends Context.Service<
  PtyTransport,
  {
    readonly spawn: (
      options: SpawnOptions,
    ) => Effect.Effect<PaneSession, TransportError, Scope.Scope>;
  }
>()("tmux/PtyTransport") {}
