/**
 * PTY transport as an Effect service. The app depends only on this interface,
 * so tests swap `PtyTransportMock` for the real WebSocket layer without touching
 * component code (see `src/specs.md`, AC-TRANSPORT).
 */

import { Context, Data, type Effect, type Scope, type Stream } from "effect";

/** Initial (and resize) grid dimensions for a spawned shell. */
export interface SpawnOptions {
  readonly cols: number;
  readonly rows: number;
}

/** A live connection to one shell PTY. Scope-bound: closing the scope kills it. */
export interface PaneSession {
  /** Raw PTY output bytes. */
  readonly output: Stream.Stream<Uint8Array>;
  /** Send keystrokes to the shell. */
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
