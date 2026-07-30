/**
 * Real `DialogueTransport`: one WebSocket to the example's own server, folded
 * through the same {@link Transcript} accumulator as the scripted transport
 * (AC-TURNS / AC-LIVE).
 *
 * No model call happens here. This file only carries frames. Both agents run
 * server side, because a browser cannot hold an API credential
 * (AC-NO-KEY-IN-CLIENT).
 */

import { Effect, Layer, Option, pipe, type Scope, Stream } from "effect";
import {
  decodeFrame,
  type DialogueSession,
  DialogueTransport,
  makeTranscript,
  type Transcript,
  TransportError,
} from "./transport";

/**
 * WebSocket path the server serves the dialogue on. Local dev proxies this
 * through Vite, so the derived URL never branches between dev and production.
 */
export const DIALOGUE_PATH: string = "/dialogue";

/**
 * Derive the WebSocket URL from the page's own location, upgrading the scheme for
 * https. Exported for unit test: URL derivation is pure and worth pinning.
 */
export const deriveWsUrl = (location: {
  readonly protocol: string;
  readonly host: string;
}): string =>
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${DIALOGUE_PATH}`;

/** Parse a socket payload without letting a syntax error escape as a defect. */
const parseJson = (raw: string): Effect.Effect<unknown, TransportError> =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => new TransportError({ reason: `frame is not JSON: ${String(cause)}` }),
  });

const openSocket = (url: string): Effect.Effect<WebSocket, TransportError> =>
  Effect.try({
    try: () => new WebSocket(url),
    catch: (cause) => new TransportError({ reason: `could not open ${url}: ${String(cause)}` }),
  });

/**
 * Record a failure unless the dialogue already finished cleanly. A server that
 * sends `DialogueEnded` and then closes must not be reported as a drop.
 */
const failUnlessEnded = (transcript: Transcript, reason: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const status = yield* Stream.runHead(transcript.session.status);
    if (Option.getOrUndefined(status) === "ended") {
      return;
    }
    yield* transcript.apply({ _tag: "DialogueFailed", reason });
  });

const connect = (): Effect.Effect<DialogueSession, TransportError, Scope.Scope> =>
  Effect.gen(function* () {
    const transcript = yield* makeTranscript();
    const socket = yield* openSocket(deriveWsUrl(window.location));
    yield* Effect.addFinalizer(() => Effect.sync(() => socket.close()));

    yield* pipe(
      Stream.fromEventListener<MessageEvent>(socket, "message"),
      Stream.runForEach((event) =>
        pipe(
          parseJson(String(event.data)),
          Effect.flatMap(decodeFrame),
          Effect.flatMap(transcript.apply),
          // A malformed frame is a finding, not a stream failure. Failing here
          // would fail the subscribing node and take the page with it.
          Effect.catchTag("TransportError", (error) =>
            transcript.apply({ _tag: "DialogueFailed", reason: error.reason }),
          ),
        ),
      ),
      Effect.forkScoped,
    );

    yield* pipe(
      Stream.fromEventListener(socket, "close"),
      Stream.take(1),
      Stream.runForEach(() => failUnlessEnded(transcript, "the dialogue socket closed")),
      Effect.forkScoped,
    );

    yield* pipe(
      Stream.fromEventListener(socket, "error"),
      Stream.take(1),
      Stream.runForEach(() => failUnlessEnded(transcript, "the dialogue socket errored")),
      Effect.forkScoped,
    );

    return transcript.session;
  });

/** The live transport layer. `mode` on the resulting service is `"live"`. */
export const DialogueTransportLive: Layer.Layer<DialogueTransport> = Layer.succeed(
  DialogueTransport,
  { mode: "live", connect },
);
