/**
 * Canned `DialogueTransport` for tests and keyless dev. Replays a fixed crawler
 * vs site exchange through the same {@link Transcript} accumulator the live
 * transport uses, so the client cannot tell the two apart (AC-SCRIPTED).
 *
 * Deltas are emitted **one at a time with a gap between them**, not as whole
 * turns. This is a spec requirement, not a stylistic choice: a scripted turn
 * that resolves as one string makes AC-STREAM unobservable, and the browser test
 * would silently assert final state instead of incremental rendering
 * (see `src/specs.md`, AC-STREAM).
 */

import {
  Deferred,
  type Duration,
  Effect,
  Layer,
  Option,
  pipe,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import {
  type DialogueSession,
  DialogueTransport,
  makeTranscript,
  type SignalSnapshot,
  type Speaker,
  type Transcript,
  type TransportError,
  type TurnKind,
} from "./transport";

/** One scripted turn. `chunks` are emitted in order, one delta each. */
export interface ScriptedTurn {
  readonly speaker: Speaker;
  readonly kind: TurnKind;
  readonly chunks: ReadonlyArray<string>;
}

/** A full scripted exchange: the turns, and the signal the crawler "observed". */
export interface Script {
  readonly turns: ReadonlyArray<ScriptedTurn>;
  readonly signal: SignalSnapshot;
}

const DIRECTIVE = "noai, noimageai";

/**
 * The exchange shipped with the example: crawler fetches, reads the opt-out,
 * declines to ingest, site acknowledges. Exported so a test can assert against
 * known text instead of hard-coding strings of its own.
 */
export const DEFAULT_SCRIPT: Script = {
  turns: [
    {
      speaker: "crawler",
      kind: "message",
      chunks: [
        "I collect pages for a training corpus. ",
        "Before I read this one, ",
        "I should check what it asks for.",
      ],
    },
    {
      speaker: "crawler",
      kind: "fetch-call",
      chunks: ["GET / ", "(response headers and <head>)"],
    },
    {
      speaker: "crawler",
      kind: "fetch-result",
      chunks: [
        "200 OK\n",
        `X-Robots-Tag: ${DIRECTIVE}\n`,
        `<meta name="robots" content="${DIRECTIVE}">`,
      ],
    },
    {
      speaker: "crawler",
      kind: "message",
      chunks: [
        `Both places carry "${DIRECTIVE}". `,
        "Nobody told me that in advance: ",
        "I read it off the response.",
      ],
    },
    {
      speaker: "site",
      kind: "message",
      chunks: [
        "That is the page speaking. ",
        "It is a request written where a crawler will see it, ",
        "not a mechanism that stops anything.",
      ],
    },
    {
      speaker: "crawler",
      kind: "message",
      chunks: ["Understood. ", "I am dropping this page from the corpus."],
    },
    {
      speaker: "site",
      kind: "message",
      chunks: ["Noted, and thank you. ", "The header stays either way."],
    },
  ],
  signal: {
    status: 200,
    xRobotsTag: Option.some(DIRECTIVE),
    robotsMeta: Option.some(DIRECTIVE),
  },
};

/** Gap between deltas. Short enough not to slow tests, long enough to observe. */
export const DELTA_INTERVAL: Duration.Input = "12 millis";

/** Options for {@link makeScriptedTransport}. */
export interface ScriptedOptions {
  /** Defaults to {@link DEFAULT_SCRIPT}. */
  readonly script?: Script;
  /** Defaults to {@link DELTA_INTERVAL}. `"0 millis"` still yields between deltas. */
  readonly interval?: Duration.Input;
}

/**
 * A scripted transport plus the controls a test needs to observe mid-stream
 * states rather than only the settled result.
 */
export interface ScriptedHandle {
  readonly layer: Layer.Layer<DialogueTransport>;
  /**
   * Resolves once every scripted delta has been emitted, so a test can await
   * the settled transcript without polling.
   */
  readonly awaitDrained: Effect.Effect<void>;
  /**
   * Hold replay after the next delta, so a test can assert a turn is present
   * and still growing (AC-STREAM) or toggle a filter mid-stream
   * (AC-FILTER-LIVE). Released by {@link resume}.
   */
  readonly pause: Effect.Effect<void>;
  /** Resume a paused replay. */
  readonly resume: Effect.Effect<void>;
  /**
   * Fail the dialogue as a dropped socket would, so a test can assert the page
   * stays interactive (AC-TRANSPORT-ERROR).
   */
  readonly fail: (reason: string) => Effect.Effect<void>;
}

/** Build a scripted transport. `mode` on the resulting service is `"scripted"`. */
export const makeScriptedTransport = (options: ScriptedOptions = {}): ScriptedHandle => {
  const script = options.script ?? DEFAULT_SCRIPT;
  const interval = options.interval ?? DELTA_INTERVAL;

  // Built eagerly, because the handle's controls are used before and after
  // `connect` and must address the same replay either way. `pausedRef` in
  // particular is deliberately *not* reset by `connect`: pausing before
  // connecting is a documented way to hold the replay from its first delta.
  const pausedRef = Effect.runSync(SubscriptionRef.make(false));
  const stoppedRef = Effect.runSync(SubscriptionRef.make(false));

  // Per connection, not per handle. A settled `Deferred` cannot be reused, so a
  // handle-wide one would make `awaitDrained` resolve immediately on a second
  // `connect`, reporting a replay that has not run. Likewise a `stoppedRef` left
  // `true` by an earlier `fail` would stop the next replay before its first frame
  // and leave that session stuck at `connecting` forever.
  let drained = Deferred.makeUnsafe<void>();

  /** The transcript of the current connection, so `fail` can reach it. */
  let connected: Transcript | undefined;

  /**
   * Completes as soon as the replay is not paused. `changes` emits the current
   * value first, so an unpaused replay passes straight through.
   */
  const awaitResumed = pipe(
    SubscriptionRef.changes(pausedRef),
    Stream.filter((paused) => !paused),
    Stream.take(1),
    Stream.runDrain,
  );

  const replay = (transcript: Transcript, latch: Deferred.Deferred<void>): Effect.Effect<void> =>
    pipe(
      Effect.gen(function* () {
        let index = 0;
        for (const turn of script.turns) {
          if (yield* SubscriptionRef.get(stoppedRef)) {
            return;
          }
          const id = `scripted-${index++}`;
          yield* transcript.apply({
            _tag: "TurnStarted",
            id,
            speaker: turn.speaker,
            kind: turn.kind,
          });
          for (const chunk of turn.chunks) {
            // Gated before the delta rather than after, so a handle paused
            // before `connect` holds the replay from its first delta.
            yield* awaitResumed;
            yield* Effect.sleep(interval);
            // Rechecked *after* the sleep, not only before it. `fail` runs on
            // another fiber, so a stop landing during the gap would otherwise let
            // this delta and the `TurnCompleted` below apply after
            // `DialogueFailed`, growing a turn and marking it complete under a
            // status that is documented as terminal.
            if (yield* SubscriptionRef.get(stoppedRef)) {
              return;
            }
            yield* transcript.apply({ _tag: "TurnDelta", id, text: chunk });
          }
          if (yield* SubscriptionRef.get(stoppedRef)) {
            return;
          }
          yield* transcript.apply({ _tag: "TurnCompleted", id });
          if (turn.kind === "fetch-result") {
            yield* transcript.apply({ _tag: "SignalObserved", signal: script.signal });
          }
        }
        yield* transcript.apply({
          _tag: "DialogueEnded",
          reason: "the scripted exchange finished",
        });
      }),
      // Whatever the replay does, nothing may be left awaiting it.
      Effect.ensuring(Deferred.succeed(latch, undefined)),
      Effect.asVoid,
    );

  const connect = (): Effect.Effect<DialogueSession, TransportError, Scope.Scope> =>
    Effect.gen(function* () {
      const transcript = yield* makeTranscript();
      connected = transcript;
      // Reset per connection, so a handle reconnected after a `fail` replays
      // instead of inheriting the previous run's stop flag and settled latch.
      yield* SubscriptionRef.set(stoppedRef, false);
      drained = Deferred.makeUnsafe<void>();
      yield* Effect.forkScoped(replay(transcript, drained));
      return transcript.session;
    });

  return {
    layer: Layer.succeed(DialogueTransport, { mode: "scripted", connect }),
    // Reads `drained` when awaited, not when the handle is built, so it always
    // refers to the current connection's latch.
    awaitDrained: Effect.suspend(() => Deferred.await(drained)),
    pause: SubscriptionRef.set(pausedRef, true),
    resume: SubscriptionRef.set(pausedRef, false),
    fail: (reason) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.set(stoppedRef, true);
        // The terminal frame is applied before the latch is released, so a test
        // that awaits `awaitDrained` cannot observe a transcript that is drained
        // but not yet failed.
        if (connected !== undefined) {
          yield* connected.apply({ _tag: "DialogueFailed", reason });
        }
        yield* Deferred.succeed(drained, undefined);
      }),
  };
};
