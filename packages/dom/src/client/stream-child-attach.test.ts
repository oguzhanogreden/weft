/**
 * A reactive child's markers are minted inside a `DocumentFragment`, so they
 * have a parent from birth. `handleStreamChild` forks the subscription fiber
 * before returning the region for the caller to splice in; a first emission
 * that wins that race renders into the fragment, and the splice moves markers
 * and content into the real parent atomically. Both orderings are valid by
 * construction; no coordination between fork and splice exists.
 *
 * Two proof styles below:
 *
 * - "forced, deterministic": drives `updateStreamChild` directly with explicit
 *   fiber scheduling (`startImmediately`), pinning both halves of the
 *   invariant: a pre-splice emission lands in the birth fragment and travels
 *   with the splice; an emission against a region removed from the document
 *   (parentless markers) is dropped without spinning.
 * - "reactive child attachment" (below): a dense grid mirroring the shape that
 *   found the original bug in the wild (a first emission used to be dropped
 *   when its markers were not yet attached). It needs volume and nesting to
 *   surface; a flat run of reactive children does not reproduce it, because
 *   that is what spreads the render across enough scheduler turns for some
 *   subscriptions to fire before their markers land. Kept as integration-level
 *   coverage for the real-world shape, alongside the deterministic proof above.
 *
 * Found via `examples/tmux`, where the pre-fix race dropped roughly 0.15% of
 * terminal cells.
 */

import * as assert from "node:assert/strict";
import { h } from "@weftui/core";
import { Effect, Fiber, Scope, Stream, SubscriptionRef } from "effect";
import { JSDOM } from "jsdom";
import { describe, it } from "vite-plus/test";
import { RenderContext } from "~/data";
import { makeLoomUnsafe } from "./loom";
import { updateStreamChild } from "./render";
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

/**
 * Minimal `RenderContext` for calling `updateStreamChild` directly, bypassing
 * `handleStreamChild`'s fork and `mount`'s own scheduling of the marker-insert.
 * Nothing in these tests reads `runtime`, `reportUnhandled`, or `loom`; all
 * three are wired to real, harmless implementations rather than stubs so the
 * effect resolves exactly as it would in production. `updateStreamChild`
 * itself never touches the Loom scheduler; only `handleStreamChild` does.
 */
function makeTestRenderContext(): RenderContext["Service"] {
  const scope = Scope.makeUnsafe("sequential");
  return {
    runtime: WeftApp.make().runtime,
    scope,
    rootScope: scope,
    streamIdCounter: { current: 0 },
    reportUnhandled: () => Effect.void,
    loom: makeLoomUnsafe(),
  };
}

describe("reactive child attachment (forced, deterministic)", () => {
  it("renders a pre-splice emission into the birth fragment; the splice carries it", async () => {
    createTestDOM();
    const parent = document.createElement("div");

    // The invariant `handleStreamChild` guarantees: markers are born inside a
    // DocumentFragment, so an emission always has a parent to render into.
    const fragment = document.createDocumentFragment();
    const startMarker = document.createComment("stream-start-forced");
    const endMarker = document.createComment("stream-end-forced");
    fragment.appendChild(startMarker);
    fragment.appendChild(endMarker);
    const context = makeTestRenderContext();

    await Effect.runPromise(
      Effect.gen(function* () {
        // `startImmediately` processes the emission in this call, before the
        // region is spliced anywhere: the exact ordering `handleStreamChild`
        // produces when the subscription fiber wins the race.
        const fiber = yield* Effect.forkIn(
          updateStreamChild(startMarker, endMarker, "hello").pipe(
            Effect.provideService(RenderContext, context),
          ),
          context.scope,
          { startImmediately: true },
        );
        yield* Fiber.join(fiber);

        // The splice: content rendered into the fragment travels with it.
        parent.appendChild(fragment);
      }),
    );

    assert.equal(parent.textContent, "hello");
    assert.equal(parent.childNodes.length, 3);
  });

  it("drops an emission for a region removed from the document, without spinning", async () => {
    createTestDOM();
    // Bare, parentless markers model a region whose nodes were removed from
    // the document (e.g. a swapped-out boundary fallback whose pump has not
    // been interrupted yet). A hang would trip the timeout below.
    const startMarker = document.createComment("stream-start-orphan");
    const endMarker = document.createComment("stream-end-orphan");
    const context = makeTestRenderContext();

    await Effect.runPromise(
      updateStreamChild(startMarker, endMarker, "hello").pipe(
        Effect.provideService(RenderContext, context),
      ),
    );

    // Dropping the emission is the designed behavior: markers untouched.
    assert.equal(startMarker.parentNode, null);
    assert.equal(endMarker.parentNode, null);
  }, 2000);
});

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
