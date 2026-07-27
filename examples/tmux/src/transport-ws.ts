/**
 * Real `PtyTransport` over a WebSocket to the `server/` PTY backend. Ships in the
 * app (see `main.ts`); the browser test uses the mock layer instead.
 *
 * `output` is one `Queue`-backed stream for the life of the session: a dropped
 * connection retries underneath it, so a subscriber never re-subscribes and the
 * grid is never torn down for a blip. `status` reports connection state
 * (`connecting`/`live`/`offline`/`unauthorized`) so the app can render it (see
 * `src/specs.md`, AC-REMOTE).
 *
 * Not exercised by CI (no `node-pty` in the browser suite); validate manually
 * against a running backend per `readme.md`.
 */

import { Effect, Layer, Option, pipe, Queue, Ref, Scope, Stream, SubscriptionRef } from "effect";
import {
  type ConnectionStatus,
  type PaneSession,
  PtyTransport,
  type SpawnOptions,
} from "./transport";

/**
 * Derive the backend WebSocket URL from the page's own location: `wss:` when the
 * page is `https:`, else `ws:`, same host, path `/pty`. A `token` is forwarded as
 * a query param when supplied. Local dev and a `tailscale serve` proxy therefore
 * produce the same URL shape; only what the browser already knows differs (see
 * `src/specs.md`, AC-REMOTE).
 */
export function deriveWsUrl(location: Pick<Location, "protocol" | "host">, token?: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${location.host}/pty`);
  if (token !== undefined && token !== "") url.searchParams.set("token", token);
  return url.toString();
}

/** The outcome of a WebSocket close: retry after a delay, pause until re-armed, or stop for good. */
export type ReconnectDecision =
  | { readonly _tag: "retry"; readonly delayMillis: number }
  | { readonly _tag: "giveUp" }
  | { readonly _tag: "terminal" };

/** The backend's close code for a rejected token (see `server/server.ts`, `checkToken`). */
const UNAUTHORIZED_CLOSE_CODE = 1008;
const RECONNECT_BASE_DELAY_MILLIS = 250;
const RECONNECT_MAX_DELAY_MILLIS = 5_000;
const RECONNECT_GIVE_UP_AFTER_MILLIS = 120_000;

/** The backoff delay for the nth (0-indexed) consecutive failed attempt. */
function delayForAttempt(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY_MILLIS * 2 ** attempt, RECONNECT_MAX_DELAY_MILLIS);
}

/** Total elapsed backoff through and including the nth attempt. */
function cumulativeDelayThrough(attempt: number): number {
  let total = 0;
  for (let n = 0; n <= attempt; n++) total += delayForAttempt(n);
  return total;
}

/**
 * Decide what to do after a WebSocket close. Close code `1008` (the backend's
 * token rejection) is always `terminal`, at any attempt: retrying a wrong token
 * cannot succeed. Otherwise backs off exponentially from 250ms doubling per
 * attempt, capped at 5s, and gives up (`giveUp`) once the cumulative delay would
 * exceed roughly two minutes (see `src/specs.md`, AC-REMOTE).
 */
export function nextReconnectDecision(closeCode: number, attempt: number): ReconnectDecision {
  if (closeCode === UNAUTHORIZED_CLOSE_CODE) return { _tag: "terminal" };
  if (cumulativeDelayThrough(attempt) > RECONNECT_GIVE_UP_AFTER_MILLIS) return { _tag: "giveUp" };
  return { _tag: "retry", delayMillis: delayForAttempt(attempt) };
}

/** Mutable state one connection loop threads across reconnects. */
interface ConnectionResources {
  readonly queue: Queue.Queue<Uint8Array>;
  readonly statusRef: SubscriptionRef.SubscriptionRef<ConnectionStatus>;
  readonly socketRef: Ref.Ref<Option.Option<WebSocket>>;
  readonly sizeRef: Ref.Ref<SpawnOptions>;
}

/** The outcome of one connection attempt: its close code, and whether it ever reached `live`. */
interface ConnectionAttemptResult {
  readonly closeCode: number;
  readonly opened: boolean;
}

/**
 * Run one connection attempt to completion: feed every message into the shared
 * queue, flip `status` to `live` on open and expose the socket for `write`/
 * `resize`, and resolve once it closes. Never fails; a connection that never
 * opens still ends in a `close` event (per the WebSocket spec, `error` is
 * always followed by `close`), so there is nothing else to observe.
 */
function attemptConnection(
  url: string,
  resources: ConnectionResources,
): Effect.Effect<ConnectionAttemptResult> {
  return Effect.scoped(
    Effect.gen(function* () {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      yield* Effect.addFinalizer(() => Effect.sync(() => ws.close()));
      const openedRef = yield* Ref.make(false);

      yield* pipe(
        Stream.fromEventListener<MessageEvent>(ws, "message"),
        Stream.map((event) => new Uint8Array(event.data as ArrayBuffer)),
        Stream.runForEach((bytes) => Queue.offer(resources.queue, bytes)),
        Effect.forkScoped,
      );

      yield* pipe(
        Stream.fromEventListener(ws, "open"),
        Stream.take(1),
        Stream.runForEach(() =>
          Effect.andThen(
            Ref.set(openedRef, true),
            Effect.andThen(
              Ref.set(resources.socketRef, Option.some(ws)),
              SubscriptionRef.set(resources.statusRef, "live"),
            ),
          ),
        ),
        Effect.forkScoped,
      );

      const closeEvent = yield* pipe(
        Stream.fromEventListener<CloseEvent>(ws, "close"),
        Stream.take(1),
        Stream.runHead,
      );
      yield* Ref.set(resources.socketRef, Option.none());
      const closeCode = Option.match(closeEvent, {
        onNone: () => 1006,
        onSome: (event) => event.code,
      });
      const opened = yield* Ref.get(openedRef);
      return { closeCode, opened };
    }),
  );
}

/** How often to retry while `offline`, in case the page never leaves and returns. */
const OFFLINE_POLL_INTERVAL_MILLIS = 30_000;

/**
 * Resolves on the next wake signal: the page becoming visible, or a periodic
 * fallback timer, whichever comes first. The fallback matters because
 * `visibilitychange` only fires on a transition: a tab that is already visible
 * and stays visible would otherwise wait forever for an event that can never
 * come, leaving a desktop session stuck `offline` even after the backend comes
 * back (see `src/specs.md`, AC-REMOTE).
 */
function waitForWake(): Effect.Effect<void> {
  const becameVisible = pipe(
    Stream.fromEventListener(document, "visibilitychange"),
    Stream.filter(() => document.visibilityState === "visible"),
    Stream.take(1),
    Stream.runDrain,
  );
  return Effect.race(becameVisible, Effect.sleep(OFFLINE_POLL_INTERVAL_MILLIS));
}

/** The URL for one connection attempt: `deriveWsUrl` plus the current grid size. */
export function buildConnectUrl(
  location: Pick<Location, "protocol" | "host">,
  token: string | undefined,
  size: SpawnOptions,
): string {
  const url = new URL(deriveWsUrl(location, token));
  url.searchParams.set("cols", String(size.cols));
  url.searchParams.set("rows", String(size.rows));
  return url.toString();
}

/**
 * The attempt count to score a just-ended connection's close against. An
 * attempt that reached `live` before closing resets the streak to 0: the
 * backoff is for consecutive failures, not drops over the session's whole
 * lifetime, so a connection that worked for an hour before a blip must not
 * inherit whatever attempt count a much earlier, unrelated outage left behind
 * (see `src/specs.md`, AC-REMOTE). A rejected token also opens before it
 * closes (the handshake completes first), so this resets on `terminal`
 * closes too; harmless only because `runConnectionLoop` checks `terminal`
 * before it ever reads `attempt`.
 */
export function attemptAfter(previousAttempt: number, opened: boolean): number {
  return opened ? 0 : previousAttempt;
}

/**
 * The reconnection loop: connect, and on close either retry (after backoff),
 * pause until the page wakes (`giveUp`), or stop for good (`terminal`, a
 * rejected token). Runs for the life of the session; forked once from `spawn`.
 */
function runConnectionLoop(
  location: Pick<Location, "protocol" | "host">,
  token: string | undefined,
  resources: ConnectionResources,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    let attempt = 0;
    while (true) {
      const size = yield* Ref.get(resources.sizeRef);
      const { closeCode, opened } = yield* attemptConnection(
        buildConnectUrl(location, token, size),
        resources,
      );
      attempt = attemptAfter(attempt, opened);

      const decision = nextReconnectDecision(closeCode, attempt);
      if (decision._tag === "terminal") {
        yield* SubscriptionRef.set(resources.statusRef, "unauthorized");
        return;
      }
      if (decision._tag === "giveUp") {
        yield* SubscriptionRef.set(resources.statusRef, "offline");
        yield* waitForWake();
        attempt = 0;
        yield* SubscriptionRef.set(resources.statusRef, "connecting");
        continue;
      }
      yield* SubscriptionRef.set(resources.statusRef, "connecting");
      attempt++;
      yield* Effect.sleep(decision.delayMillis);
    }
  });
}

const spawn = (options: SpawnOptions): Effect.Effect<PaneSession, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.make<Uint8Array>();
    const statusRef = yield* SubscriptionRef.make<ConnectionStatus>("connecting");
    const socketRef = yield* Ref.make<Option.Option<WebSocket>>(Option.none());
    const sizeRef = yield* Ref.make<SpawnOptions>(options);
    const resources: ConnectionResources = { queue, statusRef, socketRef, sizeRef };

    const token = new URLSearchParams(window.location.search).get("token") ?? undefined;
    yield* Effect.forkScoped(runConnectionLoop(window.location, token, resources));

    const sendIfLive = (message: object) =>
      Effect.gen(function* () {
        const ws = yield* Ref.get(socketRef);
        if (Option.isSome(ws)) ws.value.send(JSON.stringify(message));
      });

    return {
      output: Stream.fromQueue(queue),
      status: SubscriptionRef.changes(statusRef),
      write: (data) => sendIfLive({ type: "input", data }),
      resize: (cols, rows) =>
        Effect.andThen(
          Ref.set(sizeRef, { cols, rows }),
          sendIfLive({ type: "resize", cols, rows }),
        ),
    } satisfies PaneSession;
  });

/**
 * Real WebSocket-backed transport. Derives its URL from the page (see `deriveWsUrl`), reconnects
 * automatically on drop, and forwards `?token=` from `location.search` if present.
 */
export const PtyTransportWebSocketLive = Layer.succeed(PtyTransport, { spawn });
