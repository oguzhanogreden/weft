/**
 * The dialogue transport as an Effect service. The app depends only on this
 * interface, so tests swap the scripted transport for the real WebSocket layer
 * without touching component code (see `src/specs.md`, AC-SCRIPTED / AC-E2E).
 *
 * The transport owns accumulated turn state, deliberately. A turn's text lives
 * behind a `Stream` that emits its current value on subscribe, so a speaker
 * hidden by a filter toggle keeps accumulating off screen and renders complete
 * when re-enabled (AC-FILTER-LIVE).
 */

import { Context, Data, Effect, Option, type Scope, Stream, SubscriptionRef } from "effect";

/** Which agent produced a turn. */
export type Speaker = "crawler" | "site";

/**
 * What a turn represents. `fetch-call` and `fetch-result` are surfaced as their
 * own turns so the transcript shows the HTTP round-trip rather than jumping from
 * question to conclusion (AC-TOOL-TURN). `refusal` is a model that declined
 * (AC-REFUSAL); `error` is a transport or model failure (AC-TRANSPORT-ERROR).
 */
export type TurnKind = "message" | "fetch-call" | "fetch-result" | "refusal" | "error";

/**
 * One turn in the transcript. `id` is stable for the turn's lifetime and is the
 * reconciliation key, so a turn already on screen is never re-created when a
 * later turn arrives (AC-ORDER).
 */
export interface Turn {
  readonly id: string;
  readonly speaker: Speaker;
  readonly kind: TurnKind;
  /**
   * Text accumulated so far, growing while the turn generates. Emits its
   * current value on subscribe, so re-showing a filtered-out turn renders the
   * text that arrived while it was hidden rather than starting blank
   * (AC-STREAM / AC-FILTER-LIVE).
   */
  readonly text: Stream.Stream<string>;
  /** `false` while the turn is still generating, `true` once complete. */
  readonly complete: Stream.Stream<boolean>;
}

/**
 * The `noai` signal exactly as the crawler's fetch observed it. `Option` because
 * an absent header and an empty header are different findings, and the panel
 * renders the received strings without re-serializing them (AC-SIGNAL-PANEL).
 */
export interface SignalSnapshot {
  readonly status: number;
  /** Raw `X-Robots-Tag` response header value, verbatim. */
  readonly xRobotsTag: Option.Option<string>;
  /** Raw `content` attribute of the `robots` meta tag, verbatim. */
  readonly robotsMeta: Option.Option<string>;
}

/**
 * Connection and dialogue state. `ended` is the normal terminal state once both
 * agents stop; `failed` is terminal after a dropped socket or a failed model
 * call, and leaves the page interactive (AC-TRANSPORT-ERROR).
 */
export type DialogueStatus = "connecting" | "live" | "ended" | "failed";

/**
 * Whether the run is backed by real model calls or the canned exchange. Drives
 * the scripted-mode banner, the only client-visible difference between the two
 * (AC-SCRIPTED / AC-LIVE).
 */
export type TransportMode = "live" | "scripted";

/**
 * One connected dialogue. Scope-bound: closing the scope closes the socket.
 *
 * **Every stream here is infallible (`E = never`), deliberately.** A failure is
 * carried as *data* instead: `status` goes to `"failed"` and an `error`-kind turn
 * is appended. This is what AC-TRANSPORT-ERROR requires. Were these streams
 * allowed to fail, a dropped socket would fail the subscribing node and take the
 * page down with it, which is the opposite of "the page stays interactive and the
 * toggles keep working". It is also why the view components are `Node<never, …>`.
 */
export interface DialogueSession {
  /**
   * The full transcript so far, unfiltered, in arrival order. Filtering is the
   * view's job: this is the source of truth and is independent of what is
   * mounted (AC-TURNS / AC-FILTER-LIVE).
   */
  readonly turns: Stream.Stream<ReadonlyArray<Turn>>;
  /** The fetched signal, `None` until the crawler's fetch returns. */
  readonly signal: Stream.Stream<Option.Option<SignalSnapshot>>;
  /** Current dialogue state. Emits on subscribe, so a late subscriber is never blank. */
  readonly status: Stream.Stream<DialogueStatus>;
}

/** Transport failure (socket open/refused, unexpected close, malformed frame). */
export class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: string;
}> {}

/**
 * The transport capability. `connect` yields a session bound to the calling
 * scope, so an unmounted app closes its socket.
 */
export class DialogueTransport extends Context.Service<
  DialogueTransport,
  {
    /** Which backend this layer represents; the banner reads it (AC-SCRIPTED). */
    readonly mode: TransportMode;
    readonly connect: () => Effect.Effect<DialogueSession, TransportError, Scope.Scope>;
  }
>()("noai/DialogueTransport") {}

/**
 * Wire frames sent by the server over the WebSocket. Kept separate from {@link Turn}
 * because the wire is append-only deltas while the client holds accumulated
 * state: `TurnDelta` appends into a turn that is already mounted (AC-STREAM).
 */
export type DialogueFrame =
  | {
      readonly _tag: "TurnStarted";
      readonly id: string;
      readonly speaker: Speaker;
      readonly kind: TurnKind;
    }
  | { readonly _tag: "TurnDelta"; readonly id: string; readonly text: string }
  | { readonly _tag: "TurnCompleted"; readonly id: string }
  | { readonly _tag: "SignalObserved"; readonly signal: SignalSnapshot }
  | { readonly _tag: "DialogueEnded"; readonly reason: string }
  | { readonly _tag: "DialogueFailed"; readonly reason: string };

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

const invalid = (reason: string): Effect.Effect<never, TransportError> =>
  Effect.fail(new TransportError({ reason }));

const decodeString = (value: unknown, field: string): Effect.Effect<string, TransportError> =>
  typeof value === "string" ? Effect.succeed(value) : invalid(`${field} is not a string`);

const decodeLiteral = <A extends string>(
  value: unknown,
  allowed: ReadonlyArray<A>,
  field: string,
): Effect.Effect<A, TransportError> => {
  const found = allowed.find((candidate) => candidate === value);
  return found === undefined
    ? invalid(`${field} is not one of ${allowed.join(", ")}: ${String(value)}`)
    : Effect.succeed(found);
};

/**
 * Accepts either an in-memory `Option` or the `string | null` a JSON frame
 * carries. Two shapes because the same decoder serves the socket and the
 * in-process transports, and `Option` has no stable JSON encoding worth
 * committing to for a two-field payload.
 */
const decodeOptionalString = (
  value: unknown,
  field: string,
): Effect.Effect<Option.Option<string>, TransportError> => {
  if (Option.isOption(value)) {
    const inner = Option.getOrUndefined(value);
    if (inner === undefined) {
      return Effect.succeed(Option.none());
    }
    return typeof inner === "string"
      ? Effect.succeed(Option.some(inner))
      : invalid(`${field} holds a non-string`);
  }
  if (value === null || value === undefined) {
    return Effect.succeed(Option.none());
  }
  return typeof value === "string"
    ? Effect.succeed(Option.some(value))
    : invalid(`${field} is not a string`);
};

const decodeSnapshot = (input: unknown): Effect.Effect<SignalSnapshot, TransportError> =>
  Effect.gen(function* () {
    if (!isRecord(input)) {
      return yield* invalid("signal is not an object");
    }
    if (typeof input.status !== "number") {
      return yield* invalid("signal.status is not a number");
    }
    return {
      status: input.status,
      xRobotsTag: yield* decodeOptionalString(input.xRobotsTag, "signal.xRobotsTag"),
      robotsMeta: yield* decodeOptionalString(input.robotsMeta, "signal.robotsMeta"),
    };
  });

const SPEAKERS: ReadonlyArray<Speaker> = ["crawler", "site"];

const KINDS: ReadonlyArray<TurnKind> = [
  "message",
  "fetch-call",
  "fetch-result",
  "refusal",
  "error",
];

/**
 * Decodes an untrusted WebSocket frame. The socket is an I/O boundary carrying
 * `unknown`, so frames are validated rather than cast (AC-TRANSPORT-ERROR).
 */
export const decodeFrame = (input: unknown): Effect.Effect<DialogueFrame, TransportError> =>
  Effect.gen(function* () {
    if (!isRecord(input)) {
      return yield* invalid(`frame is not an object: ${input === null ? "null" : typeof input}`);
    }
    switch (input._tag) {
      case "TurnStarted":
        return {
          _tag: "TurnStarted" as const,
          id: yield* decodeString(input.id, "TurnStarted.id"),
          speaker: yield* decodeLiteral(input.speaker, SPEAKERS, "TurnStarted.speaker"),
          kind: yield* decodeLiteral(input.kind, KINDS, "TurnStarted.kind"),
        };
      case "TurnDelta":
        return {
          _tag: "TurnDelta" as const,
          id: yield* decodeString(input.id, "TurnDelta.id"),
          text: yield* decodeString(input.text, "TurnDelta.text"),
        };
      case "TurnCompleted":
        return {
          _tag: "TurnCompleted" as const,
          id: yield* decodeString(input.id, "TurnCompleted.id"),
        };
      case "SignalObserved":
        return { _tag: "SignalObserved" as const, signal: yield* decodeSnapshot(input.signal) };
      case "DialogueEnded":
        return {
          _tag: "DialogueEnded" as const,
          reason: yield* decodeString(input.reason, "DialogueEnded.reason"),
        };
      case "DialogueFailed":
        return {
          _tag: "DialogueFailed" as const,
          reason: yield* decodeString(input.reason, "DialogueFailed.reason"),
        };
      default:
        return yield* invalid(`unknown frame tag: ${String(input._tag)}`);
    }
  });

/**
 * Writable transcript accumulator behind a read-only {@link DialogueSession}.
 *
 * Both transports fold frames through the same accumulator, which is why
 * scripted and live runs are indistinguishable to the client. Exported so a unit
 * test can drive accumulation frame by frame with no socket and no mounted tree.
 */
export interface Transcript {
  /** The read-only view handed to the app. */
  readonly session: DialogueSession;
  /** Fold one frame into accumulated state. */
  readonly apply: (frame: DialogueFrame) => Effect.Effect<void>;
}

/** A turn's public view plus the refs behind it. */
interface TurnState {
  readonly turn: Turn;
  readonly text: SubscriptionRef.SubscriptionRef<string>;
  readonly complete: SubscriptionRef.SubscriptionRef<boolean>;
}

/**
 * Build an empty transcript. Scope-bound: the per-turn text refs live for the
 * scope's lifetime, which is what lets a hidden turn keep accumulating
 * (AC-FILTER-LIVE).
 */
export const makeTranscript = (): Effect.Effect<Transcript, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Keyed by turn id rather than searched in `turns`: a delta arrives per
    // token, so this is the hot path.
    const states = new Map<string, TurnState>();
    const turnsRef = yield* SubscriptionRef.make<ReadonlyArray<Turn>>([]);
    const signalRef = yield* SubscriptionRef.make<Option.Option<SignalSnapshot>>(Option.none());
    const statusRef = yield* SubscriptionRef.make<DialogueStatus>("connecting");

    /** Any non-terminal frame proves the dialogue is running. Terminal states stick. */
    const markLive = SubscriptionRef.update(statusRef, (status) =>
      status === "connecting" ? "live" : status,
    );

    const startTurn = (id: string, speaker: Speaker, kind: TurnKind): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (states.has(id)) {
          return;
        }
        const text = yield* SubscriptionRef.make("");
        const complete = yield* SubscriptionRef.make(false);
        const turn: Turn = {
          id,
          speaker,
          kind,
          text: SubscriptionRef.changes(text),
          complete: SubscriptionRef.changes(complete),
        };
        states.set(id, { turn, text, complete });
        yield* SubscriptionRef.update(turnsRef, (turns) => [...turns, turn]);
      });

    const apply = (frame: DialogueFrame): Effect.Effect<void> => {
      switch (frame._tag) {
        case "TurnStarted":
          return Effect.andThen(markLive, startTurn(frame.id, frame.speaker, frame.kind));
        case "TurnDelta": {
          const state = states.get(frame.id);
          // A delta for an unknown turn is dropped rather than failing the
          // stream: the page must survive a frame it cannot place.
          return state === undefined
            ? markLive
            : Effect.andThen(
                markLive,
                SubscriptionRef.update(state.text, (text) => text + frame.text),
              );
        }
        case "TurnCompleted": {
          const state = states.get(frame.id);
          return state === undefined
            ? markLive
            : Effect.andThen(markLive, SubscriptionRef.set(state.complete, true));
        }
        case "SignalObserved":
          return Effect.andThen(
            markLive,
            SubscriptionRef.set(signalRef, Option.some(frame.signal)),
          );
        case "DialogueEnded":
          // A failed dialogue stays failed: a trailing "ended" would report a
          // clean finish for a dropped socket.
          return SubscriptionRef.update(statusRef, (status) =>
            status === "failed" ? status : "ended",
          );
        case "DialogueFailed":
          return SubscriptionRef.set(statusRef, "failed");
      }
    };

    return {
      session: {
        turns: SubscriptionRef.changes(turnsRef),
        signal: SubscriptionRef.changes(signalRef),
        status: SubscriptionRef.changes(statusRef),
      },
      apply,
    };
  });
