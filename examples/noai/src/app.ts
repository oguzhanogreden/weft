/**
 * noai example: two model-backed agents negotiating an AI opt-out signal, with
 * the whole exchange visible as it streams.
 *
 * A crawler agent fetches this example's own page and reads the `X-Robots-Tag`
 * response header and `robots` meta tag. A site agent speaks for the page. The
 * transcript renders both sides; two toggles filter by speaker.
 *
 * Side-effect-free: exports `App` (no top-level mount) so tests can mount it with
 * the scripted transport. `App` depends on the `DialogueTransport` service; the
 * concrete layer is chosen by the entry point (`main.ts` = WebSocket,
 * tests = scripted).
 *
 * The filter **derives the visible list** rather than hiding nodes with CSS: a
 * disabled speaker's turns leave the keyed region entirely. Accumulated text
 * lives in the transport, not the view, so a hidden speaker keeps growing off
 * screen and renders complete when re-enabled. See `src/specs.md`, AC-FILTER /
 * AC-FILTER-LIVE, and the render-strategy note above those criteria.
 */

import { h, List, type Node } from "@weftui/core";
import { Effect, Option, type Scope, Stream, SubscriptionRef } from "effect";
import {
  type DialogueSession,
  type DialogueStatus,
  DialogueTransport,
  type SignalSnapshot,
  type Speaker,
  type TransportError,
  type Turn,
} from "./transport";

/** Which speakers are currently shown. Both start `true` (AC-FILTER). */
export interface SpeakerFilter {
  readonly crawler: boolean;
  readonly site: boolean;
}

/** Every speaker visible: the mounted default. */
export const ALL_VISIBLE: SpeakerFilter = { crawler: true, site: true };

/** Human-facing label per speaker, used by the toggles and turn attribution. */
export const SPEAKER_LABEL: Record<Speaker, string> = {
  crawler: "Crawler",
  site: "Site",
};

/**
 * Shown when the derived list is empty because both toggles are off. A distinct
 * message, not a blank region (AC-FILTER-EMPTY).
 */
export const EMPTY_FILTER_MESSAGE: string =
  "Both speakers are hidden. Turn one back on to read the exchange.";

/** Short word per dialogue state, for the status pill. */
const STATUS_LABEL: Record<DialogueStatus, string> = {
  connecting: "connecting…",
  live: "live",
  ended: "ended",
  failed: "failed",
};

/** Shown in the signal panel before the crawler's fetch has returned. */
const PENDING = "not fetched yet";

/** Shown for a field the response did not carry at all. */
const ABSENT = "(absent)";

const SCRIPTED_NOTE =
  "No API credential resolved, so this run replays a scripted exchange. Everything else on the page behaves the same.";

const LEDE =
  "A crawler agent fetches this page, reads what it asks for, and talks to the agent that speaks for it. Toggle a speaker to read one side alone.";

/** Per-turn suffix while a turn is still generating. */
const GENERATING = "…";

/**
 * Derive the visible transcript from the full one. Pure, and exported so a unit
 * test can pin filter semantics without mounting: identity of retained turns is
 * preserved, which is what lets the keyed region skip re-creating them
 * (AC-FILTER / AC-ORDER).
 */
export const visibleTurns = (
  turns: ReadonlyArray<Turn>,
  filter: SpeakerFilter,
): ReadonlyArray<Turn> => turns.filter((turn) => filter[turn.speaker]);

/**
 * Toggle one speaker, returning the next filter. Separate from the ref so the
 * transition is testable on its own.
 */
export const toggleSpeaker = (filter: SpeakerFilter, speaker: Speaker): SpeakerFilter =>
  speaker === "crawler"
    ? { crawler: !filter.crawler, site: filter.site }
    : { crawler: filter.crawler, site: !filter.site };

/** A speaker checkbox, bound to `filter` (AC-FILTER). */
export const SpeakerToggle = (
  speaker: Speaker,
  filter: SubscriptionRef.SubscriptionRef<SpeakerFilter>,
): Node<never, never> =>
  h.label({ class: "speaker-toggle" }, [
    h.input({
      type: "checkbox",
      "data-speaker": speaker,
      checked: Stream.map(SubscriptionRef.changes(filter), (current) => current[speaker]),
      onchange: () => SubscriptionRef.update(filter, (current) => toggleSpeaker(current, speaker)),
    }),
    h.span(SPEAKER_LABEL[speaker]),
  ]);

/**
 * One transcript entry. Subscribes to the turn's own accumulated text, so the
 * node mutates in place as deltas arrive instead of being rebuilt (AC-STREAM).
 */
export const TurnView = (turn: Turn): Node<never, never> =>
  h.article(
    {
      class: `turn turn-${turn.speaker} turn-${turn.kind}`,
      "data-speaker": turn.speaker,
      "data-kind": turn.kind,
      "data-turn-id": turn.id,
      "data-complete": Stream.map(turn.complete, String),
    },
    [
      h.div({ class: "speaker" }, SPEAKER_LABEL[turn.speaker]),
      h.span({ class: "turn-text" }, [turn.text]),
      h.span({ class: "turn-caret" }, [
        Stream.map(turn.complete, (complete) => (complete ? "" : GENERATING)),
      ]),
    ],
  );

/** One row of the signal panel, showing a received string verbatim. */
const signalRow = (
  field: string,
  label: string,
  signal: Stream.Stream<Option.Option<SignalSnapshot>>,
  read: (snapshot: SignalSnapshot) => Option.Option<string>,
): Node<never, never> =>
  h.fragment([
    h.dt(label),
    h.dd({ "data-field": field }, [
      Stream.map(signal, (current) =>
        Option.match(current, {
          onNone: () => PENDING,
          // No re-serialization: the panel shows what arrived (AC-SIGNAL-PANEL).
          onSome: (snapshot) => Option.getOrElse(read(snapshot), () => ABSENT),
        }),
      ),
    ]),
  ]);

/**
 * The signal panel: status, `X-Robots-Tag`, and the `robots` meta tag exactly as
 * the crawler received them (AC-SIGNAL-PANEL). Renders a pending state until the
 * fetch returns.
 */
export const SignalPanel = (
  signal: Stream.Stream<Option.Option<SignalSnapshot>>,
): Node<never, never> =>
  h.section({ class: "signal" }, [
    h.h2("What the crawler received"),
    h.dl([
      signalRow("status", "Status", signal, (snapshot) => Option.some(String(snapshot.status))),
      signalRow("x-robots-tag", "X-Robots-Tag", signal, (snapshot) => snapshot.xRobotsTag),
      signalRow("robots-meta", "meta name=robots", signal, (snapshot) => snapshot.robotsMeta),
    ]),
  ]);

/**
 * Banner shown only when the run is scripted, naming the reason (no credential
 * resolved). Absent on a live run (AC-SCRIPTED / AC-LIVE).
 */
export const ScriptedBanner = (): Node<never, DialogueTransport> =>
  Effect.gen(function* () {
    const transport = yield* DialogueTransport;
    return yield* transport.mode === "scripted"
      ? h.p({ class: "banner", "data-scripted": "true" }, SCRIPTED_NOTE)
      : // Absent, not hidden: nothing is rendered on a live run.
        h.fragment([]);
  });

/** Initial filter for a mounted app. Omit to show both speakers. */
export interface AppOptions {
  readonly filter?: SpeakerFilter;
}

/**
 * The keyed transcript region, named to avoid colliding with `Transcript` in
 * `./transport`, which is the writable accumulator.
 *
 * Keyed by `turn.id`. A retained key keeps its DOM nodes and its running text
 * subscription across re-emits (`list.specs.md` KR3), which is what AC-ORDER and
 * AC-FILTER rest on. A key removed by a filter has its scope closed and nodes
 * destroyed (KR4), so re-showing it renders fresh: text is recovered from the
 * transport, element identity is not preserved.
 */
export const TranscriptRegion = (
  session: DialogueSession,
  filter: SubscriptionRef.SubscriptionRef<SpeakerFilter>,
): Node<never, never> => {
  const changes = SubscriptionRef.changes(filter);
  const visible = Stream.map(Stream.zipLatest(session.turns, changes), ([turns, current]) =>
    visibleTurns(turns, current),
  );
  return h.section({ class: "transcript" }, [
    h.p({ class: "empty" }, [
      // Driven by the filter, not by list length: an empty transcript before the
      // first turn arrives is not the both-toggles-off state.
      Stream.map(changes, (current) =>
        !current.crawler && !current.site ? EMPTY_FILTER_MESSAGE : "",
      ),
    ]),
    List.each({ of: visible, by: (turn: Turn) => turn.id }, TurnView),
  ]);
};

/** The example app. */
export const App = (
  options: AppOptions = {},
): Node<TransportError, DialogueTransport | Scope.Scope> =>
  Effect.gen(function* () {
    const transport = yield* DialogueTransport;
    const session = yield* transport.connect();
    const filter = yield* SubscriptionRef.make<SpeakerFilter>(options.filter ?? ALL_VISIBLE);

    return yield* h.div({ class: "noai-app" }, [
      h.header({ class: "noai-header" }, [
        h.h1("noai"),
        h.p({ class: "noai-lede" }, LEDE),
        ScriptedBanner(),
      ]),
      h.div({ class: "filters" }, [
        h.span({ class: "filters-label" }, "Show"),
        SpeakerToggle("crawler", filter),
        SpeakerToggle("site", filter),
        h.span(
          {
            class: "dialogue-status",
            "data-status": Stream.map(session.status, (status): string => status),
          },
          [Stream.map(session.status, (status) => STATUS_LABEL[status])],
        ),
      ]),
      SignalPanel(session.signal),
      TranscriptRegion(session, filter),
    ]);
  });
