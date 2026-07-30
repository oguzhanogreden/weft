/**
 * The scripted transport: AC-SCRIPTED, and the delta-gap requirement AC-STREAM
 * rests on.
 *
 * Mid-stream assertions here pause the replay **before** connecting rather than
 * after. Pausing after connect races the replay: with a short `DELTA_INTERVAL` a
 * short script can drain before the test's `pause` lands, and the test then
 * asserts settled state while claiming to assert a mid-stream one. Pausing first
 * is deterministic whatever the interval is, so these tests pin one contract the
 * mock's JSDoc leaves implicit: a handle paused before connect holds the replay
 * from its first delta.
 */

import * as assert from "node:assert/strict";
import { Effect, Option, pipe, Stream } from "effect";
import { describe, it } from "vite-plus/test";
import { type DialogueSession, DialogueTransport, type Turn } from "./transport";
import { DEFAULT_SCRIPT, makeScriptedTransport, type ScriptedHandle } from "./transport-scripted";

/** Current value of a stream that emits on subscribe. */
const current = <A>(stream: Stream.Stream<A>): Effect.Effect<Option.Option<A>> =>
  Stream.runHead(stream);

/** Connect through the handle's layer and run `body` against the session. */
const withSession = <A>(
  handle: ScriptedHandle,
  body: (session: DialogueSession) => Effect.Effect<A>,
  beforeConnect?: Effect.Effect<void>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          if (beforeConnect !== undefined) {
            yield* beforeConnect;
          }
          const transport = yield* DialogueTransport;
          const session = yield* transport.connect();
          return yield* body(session);
        }),
        handle.layer,
      ),
    ),
  );

const turnsOf = (session: DialogueSession): Effect.Effect<ReadonlyArray<Turn>> =>
  Effect.map(current(session.turns), Option.getOrThrow);

const textOf = (turn: Turn): Effect.Effect<string> =>
  Effect.map(current(turn.text), Option.getOrThrow);

/** Full text of one scripted turn, lazily: `DEFAULT_SCRIPT` is a mock until `/implement`. */
const scriptText = (index: number): string => (DEFAULT_SCRIPT.turns[index]?.chunks ?? []).join("");

describe("AC-SCRIPTED: the canned transport identifies itself", () => {
  it("reports scripted mode, which is the only client-visible difference", async () => {
    const handle = makeScriptedTransport();
    const mode = await Effect.runPromise(
      Effect.provide(
        Effect.map(DialogueTransport, (transport) => transport.mode),
        handle.layer,
      ),
    );
    assert.equal(mode, "scripted");
  });
});

describe("DEFAULT_SCRIPT satisfies what the criteria need to be observable", () => {
  it("contains turns from both speakers (AC-TURNS)", () => {
    const speakers = new Set(DEFAULT_SCRIPT.turns.map((turn) => turn.speaker));
    assert.ok(speakers.has("crawler"));
    assert.ok(speakers.has("site"));
  });

  it("shows the HTTP round-trip as its own turns, attributed to the crawler (AC-TOOL-TURN)", () => {
    const call = DEFAULT_SCRIPT.turns.find((turn) => turn.kind === "fetch-call");
    const result = DEFAULT_SCRIPT.turns.find((turn) => turn.kind === "fetch-result");
    assert.ok(call, "a fetch-call turn");
    assert.ok(result, "a fetch-result turn");
    assert.equal(call.speaker, "crawler");
    assert.equal(result.speaker, "crawler");
  });

  it("splits at least one turn across several chunks (AC-STREAM testability)", () => {
    // A script whose turns are single strings makes incremental rendering
    // unobservable, and the browser test would silently assert final state.
    assert.ok(DEFAULT_SCRIPT.turns.some((turn) => turn.chunks.length > 1));
  });

  it("carries a signal for the panel to show (AC-SIGNAL-PANEL)", () => {
    assert.ok(Option.isSome(DEFAULT_SCRIPT.signal.xRobotsTag));
    assert.ok(Option.getOrThrow(DEFAULT_SCRIPT.signal.xRobotsTag).includes("noai"));
  });
});

describe("AC-SCRIPTED: a drained replay reproduces the script", () => {
  it("appends one turn per scripted turn, in script order", async () => {
    const handle = makeScriptedTransport();
    const shape = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.awaitDrained;
        const turns = yield* turnsOf(session);
        return turns.map((turn) => ({ speaker: turn.speaker, kind: turn.kind }));
      }),
    );
    assert.deepEqual(
      shape,
      DEFAULT_SCRIPT.turns.map((turn) => ({ speaker: turn.speaker, kind: turn.kind })),
    );
  });

  it("gives every turn a distinct id, so the keyed region can reconcile", async () => {
    const handle = makeScriptedTransport();
    const ids = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.awaitDrained;
        const turns = yield* turnsOf(session);
        return turns.map((turn) => turn.id);
      }),
    );
    assert.equal(new Set(ids).size, ids.length);
  });

  it("concatenates each turn's chunks into its text", async () => {
    const handle = makeScriptedTransport();
    const texts = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.awaitDrained;
        const turns = yield* turnsOf(session);
        const out: string[] = [];
        for (const turn of turns) {
          out.push(yield* textOf(turn));
        }
        return out;
      }),
    );
    assert.deepEqual(
      texts,
      DEFAULT_SCRIPT.turns.map((turn) => turn.chunks.join("")),
    );
  });

  it("marks every turn complete once the replay has drained", async () => {
    const handle = makeScriptedTransport();
    const flags = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.awaitDrained;
        const turns = yield* turnsOf(session);
        const out: boolean[] = [];
        for (const turn of turns) {
          out.push(Option.getOrThrow(yield* current(turn.complete)));
        }
        return out;
      }),
    );
    assert.ok(flags.length > 0);
    assert.ok(flags.every((flag) => flag === true));
  });

  it("publishes the script's signal verbatim (AC-SIGNAL-PANEL)", async () => {
    const handle = makeScriptedTransport();
    const signal = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.awaitDrained;
        return Option.getOrThrow(Option.getOrThrow(yield* current(session.signal)));
      }),
    );
    assert.deepEqual(signal, DEFAULT_SCRIPT.signal);
  });

  it("ends rather than hanging or failing", async () => {
    const handle = makeScriptedTransport();
    const status = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.awaitDrained;
        return Option.getOrThrow(yield* current(session.status));
      }),
    );
    assert.equal(status, "ended");
  });
});

describe("AC-STREAM: a turn is visible while it is still generating", () => {
  // Paused *before* connect, so this pins the empty-but-present state only: a
  // started turn with no text yet. An earlier version of this test also claimed
  // to assert partial text, but with the replay held from its first delta the
  // text is always `""`, and `full.startsWith("")` is true for every string. The
  // genuine partial-growth assertion is the next test, which resumes first.
  it("shows a started, empty, incomplete first turn while the replay is held", async () => {
    const handle = makeScriptedTransport();
    const observed = await withSession(
      handle,
      (session) =>
        Effect.gen(function* () {
          yield* Effect.sleep("60 millis");
          const turns = yield* turnsOf(session);
          const first = turns[0];
          assert.ok(first, "a turn should exist while the replay is held mid-stream");
          return {
            id: first.id,
            speaker: first.speaker,
            text: yield* textOf(first),
            complete: Option.getOrThrow(yield* current(first.complete)),
          };
        }),
      handle.pause,
    );
    assert.equal(observed.text, "");
    assert.equal(observed.complete, false);
    // The turn is real, not a placeholder: it carries the script's own identity.
    assert.equal(observed.id, "scripted-0");
    assert.equal(observed.speaker, DEFAULT_SCRIPT.turns[0]?.speaker);
  });

  it("grows a turn's text one chunk at a time, as a prefix of the whole", async () => {
    // The assertion the held-turn test above cannot make. A first chunk shorter
    // than the full text is what proves deltas are applied incrementally rather
    // than as one settled string, which is AC-STREAM's testability requirement.
    // Arrival is awaited on the turn's own text stream rather than slept for, so
    // the first delta is observed deterministically.
    //
    // The interval still has to be wide, but not because `pause` is slow: it and
    // the reads below run in this fiber with nothing suspending between them, so
    // its cost never enters the measured window. The hazard is **subscriber wake
    // latency**, the gap between chunk 0 applying and this fiber resuming from
    // `Stream.take(1)`. The next delta lands one interval after chunk 0, so the
    // margin condition is `interval > worst-case wake latency`. At 5ms a loaded
    // machine can miss it and drain the rest of the script, leaving
    // `text === full`. Do not shrink this on the reasoning that pause is cheap.
    const handle = makeScriptedTransport({ interval: "200 millis" });
    const observed = await withSession(handle, (session) =>
      Effect.gen(function* () {
        const turns = yield* pipe(
          session.turns,
          Stream.filter((current) => current.length > 0),
          Stream.take(1),
          Stream.runCollect,
        );
        const first = turns[0]?.[0];
        assert.ok(first, "the first turn should have started");
        yield* pipe(
          first.text,
          Stream.filter((text) => text.length > 0),
          Stream.take(1),
          Stream.runDrain,
        );
        yield* handle.pause;
        return {
          text: yield* textOf(first),
          complete: Option.getOrThrow(yield* current(first.complete)),
        };
      }),
    );
    const full = scriptText(0);
    const firstChunk = DEFAULT_SCRIPT.turns[0]?.chunks[0] ?? "";
    assert.ok(observed.text.length > 0, "at least one delta should have been applied");
    assert.notEqual(observed.text, full, "the turn should not have finished");
    assert.ok(full.startsWith(observed.text), "partial text should be a prefix of the whole");
    // Non-vacuous: the empty string would satisfy every assertion above.
    assert.ok(
      observed.text.startsWith(firstChunk),
      `expected the first chunk to have landed, got ${JSON.stringify(observed.text)}`,
    );
    assert.equal(observed.complete, false);
  });

  it("does not advance while paused, and advances after resume", async () => {
    const handle = makeScriptedTransport();
    const [held, stillHeld, resumed] = await withSession(
      handle,
      (session) =>
        Effect.gen(function* () {
          yield* Effect.sleep("60 millis");
          const first = (yield* turnsOf(session))[0];
          assert.ok(first);
          const a = yield* textOf(first);
          yield* Effect.sleep("150 millis");
          const b = yield* textOf(first);
          yield* handle.resume;
          yield* handle.awaitDrained;
          // KR4 aside: this reads the same `Turn` object, so it observes the
          // transport's accumulated state rather than anything mounted.
          const c = yield* textOf(first);
          return [a, b, c] as const;
        }),
      handle.pause,
    );
    assert.equal(stillHeld, held, "a paused replay must emit nothing further");
    assert.equal(resumed, scriptText(0));
    assert.ok(resumed.length > stillHeld.length);
  });

  it("still yields between deltas at a zero interval", async () => {
    // The JSDoc promises `"0 millis"` yields. A zero interval that degrades to a
    // synchronous loop would emit the whole script before anything could observe
    // it, which is what makes AC-STREAM unobservable in the browser test.
    const handle = makeScriptedTransport({ interval: "0 millis" });
    const partial = await withSession(
      handle,
      (session) =>
        Effect.gen(function* () {
          yield* Effect.sleep("60 millis");
          const turns = yield* turnsOf(session);
          return turns.length;
        }),
      handle.pause,
    );
    assert.ok(partial < DEFAULT_SCRIPT.turns.length, "a held replay must not have drained");
  });
});

describe("AC-TRANSPORT-ERROR: a failed dialogue keeps the transcript", () => {
  it("moves to failed without failing the stream", async () => {
    const handle = makeScriptedTransport();
    const status = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.fail("socket closed");
        return Option.getOrThrow(yield* current(session.status));
      }),
    );
    assert.equal(status, "failed");
  });

  it("retains the turns that had already arrived", async () => {
    const handle = makeScriptedTransport();
    const count = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.awaitDrained;
        yield* handle.fail("socket closed");
        const turns = yield* turnsOf(session);
        return turns.length;
      }),
    );
    // The page stays interactive after a drop, so the transcript read so far
    // must survive rather than being cleared.
    assert.equal(count, DEFAULT_SCRIPT.turns.length);
  });

  it("applies no further frames once the dialogue has failed", async () => {
    // `fail` runs on a different fiber from the replay. The stop flag used to be
    // checked only before the inter-delta sleep, so a stop landing during that
    // gap still let the pending delta and its `TurnCompleted` apply, growing a
    // turn and marking it complete under a status documented as terminal.
    // The interval has to be wide, and this is the whole subtlety of the test.
    // The bug is only reachable when `fail` lands while the replay fiber is
    // *inside* `Effect.sleep`, so the gap must be long enough to be sitting in
    // when the failure is issued. Measured against the unfixed replay: at a
    // 200ms interval the turn's text grows from 39 to 63 characters after
    // `DialogueFailed`; at 30ms the pre-sleep check already catches the stop and
    // the test passes either way, proving nothing.
    const handle = makeScriptedTransport({ interval: "200 millis" });
    const observed = await withSession(handle, (session) =>
      Effect.gen(function* () {
        // Wait for the first delta, not merely for the turn to appear: the turn
        // exists before any delta, and failing there is outside the window.
        const arrived = yield* pipe(
          session.turns,
          Stream.filter((current) => current.length > 0),
          Stream.take(1),
          Stream.runCollect,
        );
        const started = arrived[0]?.[0];
        assert.ok(started, "a turn should have started");
        yield* pipe(
          started.text,
          Stream.filter((text) => text.length > 0),
          Stream.take(1),
          Stream.runDrain,
        );
        // Now the fiber is asleep waiting to emit the next delta.
        yield* Effect.sleep("60 millis");
        yield* handle.fail("socket closed");
        const turns = yield* turnsOf(session);
        const first = turns[0];
        assert.ok(first, "a turn should have started before the failure");
        const settled = {
          text: yield* textOf(first),
          complete: Option.getOrThrow(yield* current(first.complete)),
          count: turns.length,
        };
        // Longer than the interval, so an in-flight delta or completion has time
        // to land if the stop gate did not hold.
        yield* Effect.sleep("600 millis");
        const after = yield* turnsOf(session);
        const firstAfter = after[0];
        assert.ok(firstAfter);
        return {
          settled,
          after: {
            text: yield* textOf(firstAfter),
            complete: Option.getOrThrow(yield* current(firstAfter.complete)),
            count: after.length,
          },
          status: Option.getOrThrow(yield* current(session.status)),
        };
      }),
    );
    assert.equal(observed.status, "failed");
    assert.equal(observed.after.text, observed.settled.text, "text grew after the failure");
    assert.equal(observed.after.complete, observed.settled.complete);
    assert.equal(observed.after.count, observed.settled.count, "a turn arrived after the failure");
    // Non-vacuous: the failure has to have interrupted a turn mid-flight, not
    // landed after the script had already drained.
    assert.equal(observed.settled.complete, false);
  });
});

describe("a handle reconnected after a failure replays instead of staying stuck", () => {
  it("gives the second session its own drain latch and a cleared stop flag", async () => {
    // `stoppedRef` and the drain `Deferred` used to be per handle. After a
    // `fail`, a second `connect` inherited both: the replay stopped before its
    // first frame, and `awaitDrained` resolved immediately on an already-settled
    // latch, reporting a replay that never ran.
    const handle = makeScriptedTransport({ interval: "0 millis" });
    const first = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.fail("socket closed");
        return Option.getOrThrow(yield* current(session.status));
      }),
    );
    assert.equal(first, "failed");

    const second = await withSession(handle, (session) =>
      Effect.gen(function* () {
        yield* handle.awaitDrained;
        const turns = yield* turnsOf(session);
        return {
          count: turns.length,
          status: Option.getOrThrow(yield* current(session.status)),
        };
      }),
    );
    assert.equal(second.count, DEFAULT_SCRIPT.turns.length);
    assert.equal(second.status, "ended");
  });
});
