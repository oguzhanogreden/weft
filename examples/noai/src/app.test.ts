/**
 * Filter semantics: the pure half of the toggle behaviour.
 *
 * Everything asserted here is DOM-free on purpose. The rendered consequences of
 * filtering (element identity across a toggle, the empty-state region) belong to
 * `/e2e`, because they depend on `List.each` reconciliation in a real browser.
 * What lives here is the derivation those consequences rest on.
 */

import * as assert from "node:assert/strict";
import { Stream } from "effect";
import { describe, it } from "vite-plus/test";
import {
  ALL_VISIBLE,
  EMPTY_FILTER_MESSAGE,
  SPEAKER_LABEL,
  type SpeakerFilter,
  toggleSpeaker,
  visibleTurns,
} from "./app";
import type { Speaker, Turn, TurnKind } from "./transport";

/** A turn stub. The filter never reads the streams, so they stay empty. */
const turn = (id: string, speaker: Speaker, kind: TurnKind = "message"): Turn => ({
  id,
  speaker,
  kind,
  text: Stream.empty,
  complete: Stream.empty,
});

const CRAWLER_ONLY: SpeakerFilter = { crawler: true, site: false };
const SITE_ONLY: SpeakerFilter = { crawler: false, site: true };
const NONE_VISIBLE: SpeakerFilter = { crawler: false, site: false };

describe("AC-FILTER: both speakers visible by default", () => {
  it("ALL_VISIBLE shows both speakers", () => {
    assert.deepEqual(ALL_VISIBLE, { crawler: true, site: true });
  });

  it("labels every speaker, so a toggle is never unlabelled", () => {
    assert.equal(typeof SPEAKER_LABEL.crawler, "string");
    assert.equal(typeof SPEAKER_LABEL.site, "string");
    assert.notEqual(SPEAKER_LABEL.crawler, SPEAKER_LABEL.site);
  });
});

describe("AC-FILTER: derives the visible list", () => {
  const turns = [
    turn("t1", "crawler"),
    turn("t2", "site"),
    turn("t3", "crawler"),
    turn("t4", "site"),
  ];

  it("returns every turn when both speakers are visible", () => {
    assert.deepEqual(
      visibleTurns(turns, ALL_VISIBLE).map((t) => t.id),
      ["t1", "t2", "t3", "t4"],
    );
  });

  it("removes the site's turns when the site is toggled off", () => {
    assert.deepEqual(
      visibleTurns(turns, CRAWLER_ONLY).map((t) => t.id),
      ["t1", "t3"],
    );
  });

  it("removes the crawler's turns when the crawler is toggled off", () => {
    assert.deepEqual(
      visibleTurns(turns, SITE_ONLY).map((t) => t.id),
      ["t2", "t4"],
    );
  });

  it("preserves arrival order among the turns it keeps", () => {
    const ids = visibleTurns([...turns, turn("t5", "crawler")], CRAWLER_ONLY).map((t) => t.id);
    assert.deepEqual(ids, ["t1", "t3", "t5"]);
  });

  it("filters tool and refusal turns by their speaker, not their kind", () => {
    const mixed = [
      turn("f1", "crawler", "fetch-call"),
      turn("f2", "crawler", "fetch-result"),
      turn("r1", "site", "refusal"),
    ];
    assert.deepEqual(
      visibleTurns(mixed, CRAWLER_ONLY).map((t) => t.id),
      ["f1", "f2"],
    );
  });
});

describe("AC-ORDER: retained turns keep object identity", () => {
  it("returns the same Turn references it was given, never copies", () => {
    const a = turn("t1", "crawler");
    const b = turn("t2", "site");
    const kept = visibleTurns([a, b], CRAWLER_ONLY);
    // Identity, not deep equality: `List.each` keys on `turn.id` and reuses a
    // retained key's DOM (list.specs.md KR3). A defensive copy here would still
    // pass a deepEqual check while breaking that reuse.
    assert.equal(kept.length, 1);
    assert.equal(kept[0], a);
  });

  it("does not mutate the input array", () => {
    const input = [turn("t1", "crawler"), turn("t2", "site")];
    visibleTurns(input, CRAWLER_ONLY);
    assert.equal(input.length, 2);
  });
});

describe("AC-FILTER-EMPTY: both toggles off", () => {
  it("derives an empty list", () => {
    assert.deepEqual(visibleTurns([turn("t1", "crawler"), turn("t2", "site")], NONE_VISIBLE), []);
  });

  it("has a non-empty message to show in place of the blank region", () => {
    assert.equal(typeof EMPTY_FILTER_MESSAGE, "string");
    assert.ok(EMPTY_FILTER_MESSAGE.length > 0);
  });
});

describe("AC-FILTER: toggleSpeaker transitions", () => {
  it("turns a visible speaker off", () => {
    assert.deepEqual(toggleSpeaker(ALL_VISIBLE, "site"), { crawler: true, site: false });
  });

  it("turns a hidden speaker back on", () => {
    assert.deepEqual(toggleSpeaker(CRAWLER_ONLY, "site"), { crawler: true, site: true });
  });

  it("leaves the other speaker untouched", () => {
    assert.equal(toggleSpeaker(ALL_VISIBLE, "crawler").site, true);
    assert.equal(toggleSpeaker(NONE_VISIBLE, "crawler").site, false);
  });

  it("round-trips back to the original filter", () => {
    assert.deepEqual(toggleSpeaker(toggleSpeaker(ALL_VISIBLE, "crawler"), "crawler"), ALL_VISIBLE);
  });

  it("does not mutate the filter it was given", () => {
    const before: SpeakerFilter = { crawler: true, site: true };
    toggleSpeaker(before, "crawler");
    assert.deepEqual(before, { crawler: true, site: true });
  });
});
