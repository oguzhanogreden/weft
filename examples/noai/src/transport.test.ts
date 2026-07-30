/**
 * Frame decoding and transcript accumulation.
 *
 * This is where the streaming contract is pinned without a socket or a DOM. The
 * accumulator is shared by both transports, so asserting it here covers the
 * scripted and live paths at once.
 */

import * as assert from "node:assert/strict";
import { Deferred, Effect, Exit, Fiber, Option, Stream } from "effect";
import { describe, it } from "vite-plus/test";
import {
  type DialogueFrame,
  decodeFrame,
  makeTranscript,
  type SignalSnapshot,
  type Speaker,
  TransportError,
  type Transcript,
  type TurnKind,
} from "./transport";

/** Current value of a stream that emits on subscribe. */
const current = <A>(stream: Stream.Stream<A>): Effect.Effect<Option.Option<A>> =>
  Stream.runHead(stream);

/** Run a scoped transcript program to a promise. */
const withTranscript = <A>(body: (t: Transcript) => Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(makeTranscript(), body)));

const started = (id: string, speaker: Speaker, kind: TurnKind = "message"): DialogueFrame => ({
  _tag: "TurnStarted",
  id,
  speaker,
  kind,
});

const delta = (id: string, text: string): DialogueFrame => ({ _tag: "TurnDelta", id, text });

const SNAPSHOT: SignalSnapshot = {
  status: 200,
  xRobotsTag: Option.some("noai, noimageai"),
  robotsMeta: Option.some("noai, noimageai"),
};

describe("AC-TRANSPORT-ERROR: decodeFrame validates an untrusted socket frame", () => {
  it("decodes each well-formed frame tag", async () => {
    const frames: ReadonlyArray<DialogueFrame> = [
      started("t1", "crawler"),
      delta("t1", "hello"),
      { _tag: "TurnCompleted", id: "t1" },
      { _tag: "SignalObserved", signal: SNAPSHOT },
      { _tag: "DialogueEnded", reason: "done" },
      { _tag: "DialogueFailed", reason: "socket closed" },
    ];
    for (const frame of frames) {
      assert.deepEqual(await Effect.runPromise(decodeFrame(frame)), frame);
    }
  });

  it("fails with TransportError on an unknown tag", async () => {
    const error = await Effect.runPromise(Effect.flip(decodeFrame({ _tag: "Nope" })));
    assert.ok(error instanceof TransportError);
    assert.equal(error._tag, "TransportError");
  });

  it("fails with TransportError on a missing field", async () => {
    const exit = await Effect.runPromiseExit(decodeFrame({ _tag: "TurnDelta", id: "t1" }));
    assert.ok(Exit.isFailure(exit));
  });

  it("fails with TransportError on a wrongly typed field", async () => {
    const exit = await Effect.runPromiseExit(
      decodeFrame({ _tag: "TurnDelta", id: "t1", text: 42 }),
    );
    assert.ok(Exit.isFailure(exit));
  });

  it("fails with TransportError on a non-object frame", async () => {
    for (const bad of [null, undefined, "TurnDelta", 7, []]) {
      assert.ok(Exit.isFailure(await Effect.runPromiseExit(decodeFrame(bad))));
    }
  });

  it("rejects an unknown speaker rather than widening the union", async () => {
    const exit = await Effect.runPromiseExit(
      decodeFrame({ _tag: "TurnStarted", id: "t1", speaker: "operator", kind: "message" }),
    );
    assert.ok(Exit.isFailure(exit));
  });
});

describe("AC-TURNS: turns accumulate in arrival order", () => {
  it("starts with no turns", async () => {
    const turns = await withTranscript((t) => current(t.session.turns));
    assert.deepEqual(Option.getOrThrow(turns), []);
  });

  it("appends a turn per TurnStarted, in order", async () => {
    const ids = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("t1", "crawler"));
        yield* t.apply(started("t2", "site"));
        yield* t.apply(started("t3", "crawler"));
        const turns = yield* current(t.session.turns);
        return Option.getOrThrow(turns).map((turn) => turn.id);
      }),
    );
    assert.deepEqual(ids, ["t1", "t2", "t3"]);
  });

  it("records the speaker and kind the frame carried", async () => {
    const turn = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("t1", "site"));
        const turns = yield* current(t.session.turns);
        return Option.getOrThrow(turns)[0];
      }),
    );
    assert.equal(turn?.speaker, "site");
    assert.equal(turn?.kind, "message");
  });
});

describe("AC-STREAM: deltas append into an existing turn", () => {
  it("concatenates deltas in order", async () => {
    const text = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("t1", "crawler"));
        yield* t.apply(delta("t1", "Hello"));
        yield* t.apply(delta("t1", ", "));
        yield* t.apply(delta("t1", "world"));
        const turns = yield* current(t.session.turns);
        const turn = Option.getOrThrow(turns)[0];
        assert.ok(turn);
        return Option.getOrThrow(yield* current(turn.text));
      }),
    );
    assert.equal(text, "Hello, world");
  });

  it("does not create a new turn per delta", async () => {
    const count = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("t1", "crawler"));
        yield* t.apply(delta("t1", "a"));
        yield* t.apply(delta("t1", "b"));
        const turns = yield* current(t.session.turns);
        return Option.getOrThrow(turns).length;
      }),
    );
    assert.equal(count, 1);
  });

  it("routes deltas to the right turn when two are open", async () => {
    const texts = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("t1", "crawler"));
        yield* t.apply(started("t2", "site"));
        yield* t.apply(delta("t1", "crawler text"));
        yield* t.apply(delta("t2", "site text"));
        const turns = Option.getOrThrow(yield* current(t.session.turns));
        const out: string[] = [];
        for (const turn of turns) {
          out.push(Option.getOrThrow(yield* current(turn.text)));
        }
        return out;
      }),
    );
    assert.deepEqual(texts, ["crawler text", "site text"]);
  });

  it("marks a turn incomplete until TurnCompleted arrives", async () => {
    const [before, after] = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("t1", "crawler"));
        yield* t.apply(delta("t1", "partial"));
        const turn = Option.getOrThrow(yield* current(t.session.turns))[0];
        assert.ok(turn);
        const mid = Option.getOrThrow(yield* current(turn.complete));
        yield* t.apply({ _tag: "TurnCompleted", id: "t1" });
        const end = Option.getOrThrow(yield* current(turn.complete));
        return [mid, end] as const;
      }),
    );
    assert.equal(before, false);
    assert.equal(after, true);
  });

  it("ignores a delta for an unknown turn id rather than failing the stream", async () => {
    const count = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(delta("ghost", "text"));
        const turns = yield* current(t.session.turns);
        return Option.getOrThrow(turns).length;
      }),
    );
    assert.equal(count, 0);
  });
});

describe("AC-FILTER-LIVE: a late subscriber sees accumulated text", () => {
  it("replays the full text to a subscription opened after the deltas", async () => {
    const text = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("t1", "crawler"));
        yield* t.apply(delta("t1", "arrived "));
        yield* t.apply(delta("t1", "while hidden"));
        const turn = Option.getOrThrow(yield* current(t.session.turns))[0];
        assert.ok(turn);
        // Subscribing only now models a turn re-shown after a toggle: KR4
        // destroyed the old nodes, so the new render subscribes fresh and
        // must still see everything that accumulated meanwhile.
        return Option.getOrThrow(yield* current(turn.text));
      }),
    );
    assert.equal(text, "arrived while hidden");
  });

  it("keeps emitting to a subscriber that attached mid-turn", async () => {
    const seen = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("t1", "crawler"));
        yield* t.apply(delta("t1", "first"));
        const turn = Option.getOrThrow(yield* current(t.session.turns))[0];
        assert.ok(turn);

        const attached = yield* Deferred.make<void>();
        const collected: string[] = [];
        const fiber = yield* Effect.forkChild(
          Stream.runForEach(Stream.take(turn.text, 2), (text) =>
            Effect.gen(function* () {
              collected.push(text);
              yield* Deferred.succeed(attached, undefined);
            }),
          ),
        );

        // The readiness signal is load-bearing: `turn.text` emits its current
        // value on subscribe, so applying the next delta before the collector
        // has subscribed means the second emission is never made. Joining the
        // fiber afterwards does not close that race.
        yield* Deferred.await(attached);
        yield* t.apply(delta("t1", " second"));
        yield* Fiber.join(fiber);
        return collected;
      }),
    );
    assert.deepEqual(seen, ["first", "first second"]);
  });
});

describe("AC-SIGNAL-PANEL: the observed signal reaches the session", () => {
  it("is None before the crawler's fetch returns", async () => {
    const signal = await withTranscript((t) => current(t.session.signal));
    assert.ok(Option.isNone(Option.getOrThrow(signal)));
  });

  it("carries the received strings verbatim once observed", async () => {
    const snapshot = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply({ _tag: "SignalObserved", signal: SNAPSHOT });
        return Option.getOrThrow(Option.getOrThrow(yield* current(t.session.signal)));
      }),
    );
    assert.equal(snapshot.status, 200);
    assert.equal(Option.getOrThrow(snapshot.xRobotsTag), "noai, noimageai");
    assert.equal(Option.getOrThrow(snapshot.robotsMeta), "noai, noimageai");
  });

  it("keeps an absent header as None rather than an empty string", async () => {
    const snapshot = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply({
          _tag: "SignalObserved",
          signal: { status: 200, xRobotsTag: Option.none(), robotsMeta: Option.none() },
        });
        return Option.getOrThrow(Option.getOrThrow(yield* current(t.session.signal)));
      }),
    );
    assert.ok(Option.isNone(snapshot.xRobotsTag));
    assert.ok(Option.isNone(snapshot.robotsMeta));
  });
});

describe("AC-TRANSPORT-ERROR: the JSON wire shape of a signal frame", () => {
  // `Option` has no stable JSON form, so the server sends these two fields as
  // `string | null`. Everything else in this file hands `decodeFrame` in-memory
  // `Option`s, which would leave the shape that actually crosses the socket
  // untested: a mismatch here fails only in the browser, as a `DialogueFailed`
  // turn, with every unit test still green.
  it("reads a present header sent as a plain string", async () => {
    const frame = await Effect.runPromise(
      decodeFrame({
        _tag: "SignalObserved",
        signal: { status: 200, xRobotsTag: "noai, noimageai", robotsMeta: "noai, noimageai" },
      }),
    );
    assert.ok(frame._tag === "SignalObserved");
    assert.equal(Option.getOrThrow(frame.signal.xRobotsTag), "noai, noimageai");
    assert.equal(Option.getOrThrow(frame.signal.robotsMeta), "noai, noimageai");
  });

  it("reads an absent header sent as null", async () => {
    const frame = await Effect.runPromise(
      decodeFrame({
        _tag: "SignalObserved",
        signal: { status: 404, xRobotsTag: null, robotsMeta: null },
      }),
    );
    assert.ok(frame._tag === "SignalObserved");
    assert.equal(frame.signal.status, 404);
    assert.ok(Option.isNone(frame.signal.xRobotsTag));
    assert.ok(Option.isNone(frame.signal.robotsMeta));
  });

  it("keeps an empty header distinct from an absent one on the wire too", async () => {
    const frame = await Effect.runPromise(
      decodeFrame({
        _tag: "SignalObserved",
        signal: { status: 200, xRobotsTag: "", robotsMeta: null },
      }),
    );
    assert.ok(frame._tag === "SignalObserved");
    assert.equal(Option.getOrThrow(frame.signal.xRobotsTag), "");
    assert.ok(Option.isNone(frame.signal.robotsMeta));
  });

  it("still rejects a wrongly typed field in the wire shape", async () => {
    const exit = await Effect.runPromiseExit(
      decodeFrame({ _tag: "SignalObserved", signal: { status: 200, xRobotsTag: 42 } }),
    );
    assert.ok(Exit.isFailure(exit));
  });

  it("survives a full JSON round-trip of the shape the server sends", async () => {
    // The end-to-end pairing was verified against a running server; this pins it
    // so a change to either side cannot pass unnoticed.
    const onTheWire = JSON.stringify({
      _tag: "SignalObserved",
      signal: {
        status: 200,
        xRobotsTag: Option.getOrNull(SNAPSHOT.xRobotsTag),
        robotsMeta: Option.getOrNull(SNAPSHOT.robotsMeta),
      },
    });
    const frame = await Effect.runPromise(decodeFrame(JSON.parse(onTheWire) as unknown));
    assert.deepEqual(frame, { _tag: "SignalObserved", signal: SNAPSHOT });
  });
});

describe("AC-REFUSAL / AC-TRANSPORT-ERROR: terminal states are data, not failures", () => {
  it("starts connecting", async () => {
    const status = await withTranscript((t) => current(t.session.status));
    assert.equal(Option.getOrThrow(status), "connecting");
  });

  it("reaches ended on DialogueEnded", async () => {
    const status = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply({ _tag: "DialogueEnded", reason: "both agents stopped" });
        return Option.getOrThrow(yield* current(t.session.status));
      }),
    );
    assert.equal(status, "ended");
  });

  it("reaches failed on DialogueFailed without failing the stream", async () => {
    const status = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply({ _tag: "DialogueFailed", reason: "socket closed" });
        // The stream must still be readable: were it to fail, the subscribing
        // node would fail and take the page down with it.
        return Option.getOrThrow(yield* current(t.session.status));
      }),
    );
    assert.equal(status, "failed");
  });

  // The guard this pins had no test: deleting it left all 115 tests green. A
  // server that fails and then sends its trailing `DialogueEnded` (a socket that
  // drops while the exchange is wrapping up) would report a clean finish, so the
  // status pill would read "ended" for a dialogue that never finished.
  it("keeps a failed dialogue failed when a trailing DialogueEnded arrives", async () => {
    const status = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply({ _tag: "DialogueFailed", reason: "socket closed" });
        yield* t.apply({ _tag: "DialogueEnded", reason: "both agents stopped" });
        return Option.getOrThrow(yield* current(t.session.status));
      }),
    );
    assert.equal(status, "failed");
  });

  it("still reaches ended when DialogueEnded arrives first", async () => {
    // The other half of the guard: it must not pin every dialogue to its first
    // terminal frame, only refuse to downgrade a failure.
    const status = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply({ _tag: "DialogueEnded", reason: "both agents stopped" });
        yield* t.apply({ _tag: "DialogueEnded", reason: "again" });
        return Option.getOrThrow(yield* current(t.session.status));
      }),
    );
    assert.equal(status, "ended");
  });

  it("surfaces a refusal as a visible turn, not a dropped one", async () => {
    const turn = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("r1", "site", "refusal"));
        yield* t.apply(delta("r1", "declined"));
        return Option.getOrThrow(yield* current(t.session.turns))[0];
      }),
    );
    assert.equal(turn?.kind, "refusal");
    assert.equal(turn?.speaker, "site");
  });

  it("surfaces a transport failure as an error-kind turn", async () => {
    const turn = await withTranscript((t) =>
      Effect.gen(function* () {
        yield* t.apply(started("e1", "crawler", "error"));
        return Option.getOrThrow(yield* current(t.session.turns))[0];
      }),
    );
    assert.equal(turn?.kind, "error");
  });
});
