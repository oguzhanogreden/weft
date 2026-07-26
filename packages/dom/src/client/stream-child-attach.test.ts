/**
 * Regression: a reactive child's first emission must survive its markers not
 * being attached yet.
 *
 * `handleStreamChild` forks the subscription fiber before returning the marker
 * pair for the caller to splice into the parent. When the fiber wins that race,
 * `startMarker.parentNode` is still null. The insert used to be skipped by a
 * silent null-parent guard, and because the emission had already been consumed
 * the region stayed permanently empty: markers present, no content between them.
 *
 * It needs volume and nesting to surface. A flat run of reactive children does
 * not reproduce it; sibling containers each holding many reactive children does,
 * because that is what spreads the render across enough scheduler turns for some
 * subscriptions to fire before their markers land.
 *
 * Found via `examples/tmux`, where it dropped roughly 0.15% of terminal cells.
 */

import * as assert from "node:assert/strict";
import { h } from "@weftui/core";
import { Effect, Stream, SubscriptionRef } from "effect";
import { JSDOM } from "jsdom";
import { describe, it } from "vite-plus/test";
import * as WeftApp from "./weft-app";

const ROWS = 24;
const COLS = 80;

function createTestDOM() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Comment = dom.window.Comment;
  global.Text = dom.window.Text;
  return dom;
}

/** `ROWS` containers of `COLS` reactive children each, fed by one ref per row. */
const grid = (withStyle: boolean) =>
  Effect.gen(function* () {
    const refs: SubscriptionRef.SubscriptionRef<string>[] = [];
    for (let r = 0; r < ROWS; r++) refs.push(yield* SubscriptionRef.make("x"));

    return yield* h.div(
      { class: "grid" },
      refs.map((ref) => {
        const changes = SubscriptionRef.changes(ref);
        return h.div(
          { class: "row" },
          Array.from({ length: COLS }, () =>
            withStyle
              ? h.span({ style: Stream.map(changes, () => ({ color: "" })) }, [
                  Stream.map(changes, (value) => value),
                ])
              : h.span({}, [Stream.map(changes, (value) => value)]),
          ),
        );
      }),
    );
  });

/** Reactive regions that rendered no content at all, as `row:col`. */
function emptyRegions(root: HTMLElement): string[] {
  const empty: string[] = [];
  root.querySelectorAll(".row").forEach((row, r) => {
    row.querySelectorAll("span").forEach((cell, c) => {
      if (cell.textContent === "") empty.push(`${r}:${c}`);
    });
  });
  return empty;
}

describe("reactive child attachment", () => {
  it("renders content into every region of a dense grid", async () => {
    createTestDOM();
    const root = document.createElement("div");
    document.body.appendChild(root);

    await Effect.runPromise(WeftApp.mount(WeftApp.make(), grid(true) as never, root));
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.equal(root.querySelectorAll("span").length, ROWS * COLS);
    assert.deepEqual(emptyRegions(root), []);
  });

  it("renders content into every region without a reactive style prop", async () => {
    // The style subscription doubles the fibers per cell but is not the cause;
    // pinning that keeps a future fix from being credited to the wrong half.
    createTestDOM();
    const root = document.createElement("div");
    document.body.appendChild(root);

    await Effect.runPromise(WeftApp.mount(WeftApp.make(), grid(false) as never, root));
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.deepEqual(emptyRegions(root), []);
  });

  it("leaves no region holding only its markers", async () => {
    // The precise failure signature: `<!--stream-start-N--><!--stream-end-N-->`
    // with nothing in between. Asserted structurally, since a dropped blank is
    // invisible in text content.
    createTestDOM();
    const root = document.createElement("div");
    document.body.appendChild(root);

    await Effect.runPromise(WeftApp.mount(WeftApp.make(), grid(true) as never, root));
    await new Promise((resolve) => setTimeout(resolve, 500));

    const markersOnly = [...root.querySelectorAll("span")].filter(
      (cell) => cell.childNodes.length === 2 && cell.textContent === "",
    );
    assert.deepEqual(markersOnly, []);
  });
});
