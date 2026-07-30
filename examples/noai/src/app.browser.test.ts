/**
 * End-to-end browser test for the noai example (AC-E2E).
 *
 * Mounts the real `App` in Chromium against the scripted transport, so the run is
 * hermetic: no WebSocket, no server, no API credential. Everything asserted here
 * needs a real browser, either because it depends on `List.each` reconciliation
 * (element identity across a filter toggle) or on a node mutating in place while
 * its text stream emits (AC-STREAM).
 *
 * Out of scope, per `src/specs.md`: the two halves of the signal itself. A
 * browser-mode mount has no `<head>` from `index.html` and no response headers, so
 * `AC-SIGNAL-HEADER` and `AC-SIGNAL-META` are asserted by the node tests in
 * `server/`. What is in scope is `AC-SIGNAL-PANEL`, whose values arrive as turn
 * event data rather than from the document.
 *
 * Two intervals, deliberately. Settled-state tests replay at `"0 millis"`, which
 * still yields between deltas but removes every timing window. Mid-stream tests
 * use {@link SLOW_INTERVAL} with a script long enough that the turn cannot finish
 * between observing its first delta and pausing the replay.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App, EMPTY_FILTER_MESSAGE, SPEAKER_LABEL, type SpeakerFilter } from "./app";
import { DialogueTransport, makeTranscript, type Speaker } from "./transport";
import {
  DEFAULT_SCRIPT,
  makeScriptedTransport,
  type Script,
  type ScriptedHandle,
  type ScriptedOptions,
} from "./transport-scripted";

/** Replay as fast as the scheduler allows, for tests that assert settled state. */
const FAST_INTERVAL = "0 millis";

/** Wide enough that a mid-stream observation is never a race. */
const SLOW_INTERVAL = "120 millis";

/** Polling for mid-stream states: catch the delta, don't wait out the default 50ms. */
const MID_STREAM_POLL = { interval: 10, timeout: 4000 };

/**
 * One long crawler turn. Mid-stream tests need a turn that cannot drain inside
 * the window between observing its first delta and pausing the replay.
 */
const SLOW_SCRIPT: Script = {
  turns: [
    {
      speaker: "crawler",
      kind: "message",
      chunks: ["one ", "two ", "three ", "four ", "five"],
    },
  ],
  signal: DEFAULT_SCRIPT.signal,
};

/** A page carrying no opt-out at all, so both signal fields arrive absent. */
const ABSENT_SIGNAL_SCRIPT: Script = {
  turns: [{ speaker: "crawler", kind: "fetch-result", chunks: ["404 Not Found"] }],
  signal: { status: 404, xRobotsTag: Option.none(), robotsMeta: Option.none() },
};

/** A refusal and a failure, the two turn kinds the default script never produces. */
const DECLINED_SCRIPT: Script = {
  turns: [
    {
      speaker: "site",
      kind: "refusal",
      chunks: ["The site agent declined to continue this exchange."],
    },
    {
      speaker: "crawler",
      kind: "error",
      chunks: ["The dialogue ended early: the model call failed."],
    },
  ],
  signal: DEFAULT_SCRIPT.signal,
};

const CRAWLER_ONLY: SpeakerFilter = { crawler: true, site: false };

/** Speakers in the order the default script produces them. */
const SCRIPT_SPEAKERS: ReadonlyArray<Speaker> = DEFAULT_SCRIPT.turns.map((turn) => turn.speaker);

const CRAWLER_TURN_COUNT = SCRIPT_SPEAKERS.filter((speaker) => speaker === "crawler").length;
const SITE_TURN_COUNT = SCRIPT_SPEAKERS.filter((speaker) => speaker === "site").length;

/** The id the scripted transport assigns to the turn at `index`. */
const scriptedId = (index: number): string => `scripted-${index}`;

/** Full text of a scripted turn once every chunk has arrived. */
const joined = (script: Script, index: number): string =>
  script.turns[index]?.chunks.join("") ?? "";

let container: HTMLElement;
let app: WeftApp.WeftApp | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  // Guarded: a test that fails before `mountWith` returns has no app to dispose,
  // and an unconditional dispose would mask the real failure.
  if (app !== undefined) {
    await Effect.runPromise(WeftApp.dispose(app));
    app = undefined;
  }
  container.remove();
});

interface MountOptions extends ScriptedOptions {
  /**
   * Hold the replay before `connect`. The scripted transport applies
   * `TurnStarted` above its pause gate, so this yields a started turn with no
   * text yet: the deterministic mid-stream starting point.
   */
  readonly paused?: boolean;
  /** Initial filter, for tests needing a speaker hidden before any turn arrives. */
  readonly filter?: SpeakerFilter;
}

/**
 * Mount the app against a fresh scripted transport. The handle must be per test:
 * its pause and drain state is captured eagerly in a closure, so a reused handle
 * would carry a resolved `awaitDrained` into the next test.
 */
const mountWith = async (options: MountOptions = {}): Promise<ScriptedHandle> => {
  const handle = makeScriptedTransport({
    script: options.script,
    interval: options.interval ?? FAST_INTERVAL,
  });
  if (options.paused === true) {
    await Effect.runPromise(handle.pause);
  }
  app = WeftApp.make(handle.layer);
  await Effect.runPromise(WeftApp.mount(app, App({ filter: options.filter }), container));
  // The mounted tree is appended a tick after `mount` resolves.
  await vi.waitFor(() => expect(container.querySelector(".noai-app")).not.toBeNull());
  return handle;
};

/** Replay to completion and wait for the DOM to catch up with the last frame. */
const drain = async (handle: ScriptedHandle, expectedTurns: number): Promise<void> => {
  await Effect.runPromise(handle.awaitDrained);
  // `awaitDrained` resolves when the last frame lands in the refs; the DOM follows
  // one or more ticks later through the stream subscriptions.
  await vi.waitFor(() => expect(turnElements()).toHaveLength(expectedTurns));
};

const requireEl = <E extends Element>(selector: string): E => {
  const el = container.querySelector<E>(selector);
  if (el === null) {
    throw new Error(`no element matched ${selector}`);
  }
  return el;
};

const turnElements = (): ReadonlyArray<HTMLElement> => [
  ...container.querySelectorAll<HTMLElement>(".turn"),
];

const turnIds = (): ReadonlyArray<string | undefined> =>
  turnElements().map((el) => el.dataset.turnId);

const speakersOnScreen = (): ReadonlyArray<string | undefined> =>
  turnElements().map((el) => el.dataset.speaker);

const textOf = (el: Element): string => el.querySelector(".turn-text")?.textContent ?? "";

const caretOf = (el: Element): string => el.querySelector(".turn-caret")?.textContent ?? "";

const signalField = (field: string): string =>
  container.querySelector(`[data-field="${field}"]`)?.textContent ?? "";

const emptyMessage = (): string => container.querySelector(".empty")?.textContent ?? "";

const status = (): string | undefined =>
  container.querySelector<HTMLElement>(".dialogue-status")?.dataset.status;

const toggleFor = (speaker: Speaker): HTMLInputElement =>
  requireEl<HTMLInputElement>(`input[data-speaker="${speaker}"]`);

/**
 * Wait until the app's reactive bindings have applied their first values. A
 * queryable root does not mean a settled tree: attribute streams and
 * Effect-returning nodes land later, so `data-status` is used as the anchor.
 */
const awaitSettled = (): Promise<void> =>
  vi.waitFor(() => {
    expect(status()).not.toBeUndefined();
  });

describe("AC-TURNS: both speakers reach the browser in arrival order", () => {
  it("renders every scripted turn, attributed to its speaker, in arrival order", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    expect(speakersOnScreen()).toEqual([...SCRIPT_SPEAKERS]);
    expect(turnIds()).toEqual(DEFAULT_SCRIPT.turns.map((_, index) => scriptedId(index)));
    // The point of the example: both sides of the exchange are on screen at once.
    expect(speakersOnScreen()).toContain("crawler");
    expect(speakersOnScreen()).toContain("site");
  });

  it("labels each turn with the speaker's name rather than its key", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    const labels = turnElements().map((el) => el.querySelector(".speaker")?.textContent);
    expect(labels).toContain(SPEAKER_LABEL.crawler);
    expect(labels).toContain(SPEAKER_LABEL.site);
    expect(labels).not.toContain("crawler");
  });

  it("renders each turn's full accumulated text once the exchange has drained", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    await vi.waitFor(() => {
      DEFAULT_SCRIPT.turns.forEach((_, index) => {
        expect(textOf(requireEl(`[data-turn-id="${scriptedId(index)}"]`))).toBe(
          joined(DEFAULT_SCRIPT, index),
        );
      });
    });
  });

  it("marks every turn complete and settles on the ended status", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    await vi.waitFor(() => {
      expect(turnElements().map((el) => el.dataset.complete)).toEqual(
        DEFAULT_SCRIPT.turns.map(() => "true"),
      );
      expect(status()).toBe("ended");
      // No generating marker left behind on a finished turn. Inside the poll: the
      // caret is its own subscription to `complete` and may lag the attribute.
      expect(turnElements().every((el) => caretOf(el) === "")).toBe(true);
    });
  });
});

describe("AC-TOOL-TURN: the fetch round-trip is visible", () => {
  it("renders the fetch call and its result as their own crawler turns", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    const call = requireEl<HTMLElement>('[data-kind="fetch-call"]');
    const result = requireEl<HTMLElement>('[data-kind="fetch-result"]');
    expect(call.dataset.speaker).toBe("crawler");
    expect(result.dataset.speaker).toBe("crawler");
    // The result turn shows the bytes, not a summary of them. Under `waitFor`
    // because text arrives on the stream, and a settled turn count does not imply
    // settled text.
    await vi.waitFor(() => expect(textOf(result)).toContain("X-Robots-Tag"));
  });
});

describe("AC-STREAM: text renders while a turn is still generating", () => {
  it("shows a started turn before any of its text has arrived", async () => {
    await mountWith({ paused: true, interval: SLOW_INTERVAL, script: SLOW_SCRIPT });

    const turn = await vi.waitFor(() => {
      const el = requireEl<HTMLElement>(`[data-turn-id="${scriptedId(0)}"]`);
      // Inside the poll, not after it: a reactive attribute applies its first
      // value a tick after its element is queryable, so `data-complete` is
      // briefly absent on a turn that is already in the DOM.
      expect(el.dataset.complete).toBe("false");
      // Present and marked generating, not withheld until it has something to show.
      expect(caretOf(el)).not.toBe("");
      return el;
    }, MID_STREAM_POLL);
    // Safe to read directly: the replay is paused, so no delta can land.
    expect(textOf(turn)).toBe("");
  });

  it("grows the same element's text as deltas arrive, before the turn completes", async () => {
    const handle = await mountWith({
      paused: true,
      interval: SLOW_INTERVAL,
      script: SLOW_SCRIPT,
    });
    const full = joined(SLOW_SCRIPT, 0);

    const turn = await vi.waitFor(
      () => requireEl<HTMLElement>(`[data-turn-id="${scriptedId(0)}"]`),
      MID_STREAM_POLL,
    );
    const textNode = requireEl(`[data-turn-id="${scriptedId(0)}"] .turn-text`);

    await Effect.runPromise(handle.resume);
    await vi.waitFor(() => expect(textOf(turn).length).toBeGreaterThan(0), MID_STREAM_POLL);
    // Freeze the replay so the mid-stream assertions below read a stable state.
    await Effect.runPromise(handle.pause);

    const partial = textOf(turn);
    expect(turn.dataset.complete).toBe("false");
    expect(full.startsWith(partial)).toBe(true);
    expect(partial).not.toBe(full);

    await Effect.runPromise(handle.resume);
    await vi.waitFor(
      () => expect(textOf(turn).length).toBeGreaterThan(partial.length),
      MID_STREAM_POLL,
    );

    // The node mutated in place: growth did not replace the article or its text span.
    expect(container.querySelector(`[data-turn-id="${scriptedId(0)}"]`)).toBe(turn);
    expect(container.querySelector(`[data-turn-id="${scriptedId(0)}"] .turn-text`)).toBe(textNode);
  });
});

describe("AC-ORDER: a turn on screen is never re-created", () => {
  it("keeps the first turn's element identity as every later turn arrives", async () => {
    // Paused before connect, so the first turn's element exists with no timing
    // window to capture it in.
    const handle = await mountWith({ paused: true });
    const first = await vi.waitFor(
      () => requireEl<HTMLElement>(`[data-turn-id="${scriptedId(0)}"]`),
      MID_STREAM_POLL,
    );
    const firstText = requireEl(`[data-turn-id="${scriptedId(0)}"] .turn-text`);

    await Effect.runPromise(handle.resume);
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    expect(container.querySelector(`[data-turn-id="${scriptedId(0)}"]`)).toBe(first);
    expect(container.querySelector(`[data-turn-id="${scriptedId(0)}"] .turn-text`)).toBe(firstText);
    // Appending to the transcript mutated only the tail: the first turn is still first.
    expect(turnIds()[0]).toBe(scriptedId(0));
  });
});

describe("AC-FILTER: each toggle filters its own speaker", () => {
  it("starts with both toggles on", async () => {
    await mountWith({ paused: true });
    // A checkbox bound to a stream renders unchecked and is corrected when the
    // binding applies, so the default state is only observable under `waitFor`.
    await vi.waitFor(() => {
      expect(toggleFor("crawler").checked).toBe(true);
      expect(toggleFor("site").checked).toBe(true);
    });
  });

  it("removes the crawler's turns and keeps the site's, without re-creating them", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    const siteTurns = turnElements().filter((el) => el.dataset.speaker === "site");
    expect(siteTurns).toHaveLength(SITE_TURN_COUNT);

    toggleFor("crawler").click();

    await vi.waitFor(() => expect(turnElements()).toHaveLength(SITE_TURN_COUNT));
    expect(speakersOnScreen().every((speaker) => speaker === "site")).toBe(true);
    // KR3: a retained key keeps its DOM, so the surviving speaker's elements are
    // the same nodes. Compared with `toBe` per element, because a structural
    // `toEqual` on two distinct-but-identical articles would pass and hide a
    // re-render. Weakening this to a presence check would hide it too.
    turnElements().forEach((el, index) => expect(el).toBe(siteTurns[index]));
    expect(toggleFor("crawler").checked).toBe(false);
    expect(toggleFor("site").checked).toBe(true);
  });

  it("removes the site's turns and keeps the crawler's, without re-creating them", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    const crawlerTurns = turnElements().filter((el) => el.dataset.speaker === "crawler");
    expect(crawlerTurns).toHaveLength(CRAWLER_TURN_COUNT);

    toggleFor("site").click();

    await vi.waitFor(() => expect(turnElements()).toHaveLength(CRAWLER_TURN_COUNT));
    expect(speakersOnScreen().every((speaker) => speaker === "crawler")).toBe(true);
    turnElements().forEach((el, index) => expect(el).toBe(crawlerTurns[index]));
    expect(toggleFor("site").checked).toBe(false);
  });

  it("restores a hidden speaker's turns in arrival order when the toggle goes back on", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    toggleFor("crawler").click();
    await vi.waitFor(() => expect(turnElements()).toHaveLength(SITE_TURN_COUNT));
    toggleFor("crawler").click();

    await vi.waitFor(() => {
      expect(turnIds()).toEqual(DEFAULT_SCRIPT.turns.map((_, index) => scriptedId(index)));
      // Element identity is deliberately not asserted here: KR4 closed the scope
      // of every removed key, so these are fresh nodes. Text is what survives.
      expect(textOf(requireEl(`[data-turn-id="${scriptedId(0)}"]`))).toBe(
        joined(DEFAULT_SCRIPT, 0),
      );
    });
    expect(toggleFor("crawler").checked).toBe(true);
  });
});

describe("AC-FILTER-EMPTY: both toggles off", () => {
  it("shows the empty-state message instead of a blank region", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    toggleFor("crawler").click();
    toggleFor("site").click();

    await vi.waitFor(() => {
      expect(turnElements()).toHaveLength(0);
      expect(emptyMessage()).toBe(EMPTY_FILTER_MESSAGE);
    });
  });

  it("clears the message as soon as a speaker comes back", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);
    // The message is driven by the filter, not by list length: it must be absent
    // while turns are showing.
    expect(emptyMessage()).toBe("");

    toggleFor("crawler").click();
    toggleFor("site").click();
    await vi.waitFor(() => expect(emptyMessage()).toBe(EMPTY_FILTER_MESSAGE));

    toggleFor("site").click();
    await vi.waitFor(() => {
      expect(emptyMessage()).toBe("");
      expect(turnElements()).toHaveLength(SITE_TURN_COUNT);
    });
  });
});

describe("AC-FILTER-LIVE: hiding a speaker never interrupts the stream", () => {
  it("renders a speaker hidden from the start with the text that arrived while hidden", async () => {
    // Hidden before connect, so there is no window in which its turns were ever
    // mounted. Anything rendered after the toggle came from transport state.
    const handle = await mountWith({ filter: CRAWLER_ONLY });
    await drain(handle, CRAWLER_TURN_COUNT);
    expect(speakersOnScreen().every((speaker) => speaker === "crawler")).toBe(true);

    toggleFor("site").click();

    await vi.waitFor(() => {
      expect(turnElements()).toHaveLength(DEFAULT_SCRIPT.turns.length);
      SCRIPT_SPEAKERS.forEach((speaker, index) => {
        if (speaker !== "site") {
          return;
        }
        const turn = requireEl<HTMLElement>(`[data-turn-id="${scriptedId(index)}"]`);
        expect(textOf(turn)).toBe(joined(DEFAULT_SCRIPT, index));
        expect(turn.dataset.complete).toBe("true");
      });
    });
  });

  it("keeps accumulating a turn hidden mid-stream, and renders it complete on return", async () => {
    const handle = await mountWith({
      paused: true,
      interval: SLOW_INTERVAL,
      script: SLOW_SCRIPT,
    });
    const full = joined(SLOW_SCRIPT, 0);

    await Effect.runPromise(handle.resume);
    const partial = await vi.waitFor(() => {
      const text = textOf(requireEl(`[data-turn-id="${scriptedId(0)}"]`));
      expect(text.length).toBeGreaterThan(0);
      return text;
    }, MID_STREAM_POLL);
    expect(partial).not.toBe(full);

    // Hide the speaker while its turn is still generating.
    toggleFor("crawler").click();
    await vi.waitFor(() => expect(turnElements()).toHaveLength(0));

    await Effect.runPromise(handle.awaitDrained);
    toggleFor("crawler").click();

    await vi.waitFor(() => {
      const turn = requireEl<HTMLElement>(`[data-turn-id="${scriptedId(0)}"]`);
      // Text that arrived while nothing was mounted: the transport is the source
      // of truth, and a fresh subscription replays its current value.
      expect(textOf(turn)).toBe(full);
      expect(turn.dataset.complete).toBe("true");
    }, MID_STREAM_POLL);
  });
});

describe("AC-SIGNAL-PANEL: the received bytes, unchanged", () => {
  it("shows the status, header, and meta tag exactly as the crawler received them", async () => {
    const handle = await mountWith();
    await drain(handle, DEFAULT_SCRIPT.turns.length);

    const expected = Option.getOrElse(DEFAULT_SCRIPT.signal.xRobotsTag, () => "");
    await vi.waitFor(() => {
      expect(signalField("status")).toBe(String(DEFAULT_SCRIPT.signal.status));
      expect(signalField("x-robots-tag")).toBe(expected);
      expect(signalField("robots-meta")).toBe(
        Option.getOrElse(DEFAULT_SCRIPT.signal.robotsMeta, () => ""),
      );
    });
    // No re-serialization: the panel shows the string, not the `Option` holding it.
    expect(signalField("x-robots-tag")).not.toContain("Some");
    expect(signalField("x-robots-tag")).not.toContain('"');
  });

  it("distinguishes a field the response did not carry from one not yet fetched", async () => {
    const handle = await mountWith({ paused: true, script: ABSENT_SIGNAL_SCRIPT });

    const pending = await vi.waitFor(() => {
      const text = signalField("x-robots-tag");
      expect(text.length).toBeGreaterThan(0);
      return text;
    }, MID_STREAM_POLL);

    await Effect.runPromise(handle.resume);
    await Effect.runPromise(handle.awaitDrained);

    await vi.waitFor(() => expect(signalField("status")).toBe("404"));
    // Absent and pending are different findings, so they must not read the same.
    expect(signalField("x-robots-tag")).not.toBe(pending);
    expect(signalField("x-robots-tag").length).toBeGreaterThan(0);
  });
});

describe("AC-SCRIPTED / AC-LIVE: the banner names a scripted run", () => {
  it("shows the scripted banner when the transport is scripted", async () => {
    await mountWith({ paused: true });
    // Anchored on `awaitSettled`, then read synchronously. The absence test below
    // reads the banner at exactly this point, so proving the banner is already
    // here is what keeps that absence from passing vacuously: an absent node and
    // a not-yet-rendered node are indistinguishable.
    await awaitSettled();
    const banner = requireEl<HTMLElement>(".banner");
    expect(banner.dataset.scripted).toBe("true");
    expect(banner.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("omits the banner entirely on a live run", async () => {
    // A live-mode transport over an idle transcript: the banner reads `mode`, and
    // nothing in this assertion depends on frames arriving.
    const live = Layer.succeed(DialogueTransport, {
      mode: "live",
      connect: () => Effect.map(makeTranscript(), (transcript) => transcript.session),
    });
    app = WeftApp.make(live);
    await Effect.runPromise(WeftApp.mount(app, App(), container));
    await vi.waitFor(() => expect(container.querySelector(".noai-app")).not.toBeNull());
    await awaitSettled();

    // Absent, not hidden: on a live run there is no node to hide.
    expect(container.querySelector(".banner")).toBeNull();
    expect(container.querySelector("[data-scripted]")).toBeNull();
  });
});

describe("AC-REFUSAL / AC-TRANSPORT-ERROR: declines and failures are visible", () => {
  it("renders a refusal as its own turn rather than dropping it", async () => {
    const handle = await mountWith({ script: DECLINED_SCRIPT });
    await drain(handle, DECLINED_SCRIPT.turns.length);

    const refusal = requireEl<HTMLElement>('[data-kind="refusal"]');
    expect(refusal.dataset.speaker).toBe("site");
    await vi.waitFor(() => expect(textOf(refusal)).toBe(joined(DECLINED_SCRIPT, 0)));
  });

  // This asserts the *view* renders an `error`-kind turn, not that any producer
  // emits one: the frames come from a script written here. That the live server
  // actually emits it is `server/agents.test.ts`, "precedes the terminal frame
  // with a visible error turn". Both halves are needed, and only having this one
  // is what let the server-side gap hide (see `src/specs.md`).
  it("renders an error turn as a terminal transcript entry", async () => {
    const handle = await mountWith({ script: DECLINED_SCRIPT });
    await drain(handle, DECLINED_SCRIPT.turns.length);

    const failure = requireEl<HTMLElement>('[data-kind="error"]');
    expect(failure.dataset.speaker).toBe("crawler");
    await vi.waitFor(() => expect(textOf(failure)).toBe(joined(DECLINED_SCRIPT, 1)));
  });

  it("keeps the page interactive after the dialogue fails mid-stream", async () => {
    const handle = await mountWith({ paused: true, interval: SLOW_INTERVAL });
    await Effect.runPromise(handle.resume);
    await vi.waitFor(
      () =>
        expect(textOf(requireEl(`[data-turn-id="${scriptedId(0)}"]`)).length).toBeGreaterThan(0),
      MID_STREAM_POLL,
    );

    await Effect.runPromise(handle.fail("the socket dropped"));

    await vi.waitFor(() => expect(status()).toBe("failed"), MID_STREAM_POLL);
    // Whatever had arrived stays on screen: a failure appends, it does not reset.
    const before = turnElements().length;
    expect(before).toBeGreaterThan(0);

    // And the toggles still work, which is the substance of "stays interactive".
    toggleFor("crawler").click();
    await vi.waitFor(() => expect(turnElements()).toHaveLength(0));
    expect(emptyMessage()).toBe("");
    toggleFor("crawler").click();
    await vi.waitFor(() => expect(turnElements()).toHaveLength(before));
    expect(status()).toBe("failed");
  });
});
