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
 * Two proof styles below:
 *
 * - "forced, deterministic": calls `updateStreamChild` directly and controls
 *   fiber scheduling explicitly (`startImmediately`), so the race is forced on
 *   every run instead of statistically induced. This is the tight regression
 *   proof for the exact mechanism the fix changed.
 * - "reactive child attachment" (below): a dense grid mirroring the shape that
 *   found the bug in the wild. It needs volume and nesting to surface; a flat
 *   run of reactive children does not reproduce it, because that is what
 *   spreads the render across enough scheduler turns for some subscriptions to
 *   fire before their markers land. Kept as integration-level coverage for the
 *   real-world shape, alongside the deterministic proof above.
 *
 * Found via `examples/tmux`, where it dropped roughly 0.15% of terminal cells.
 */

import * as assert from "node:assert/strict";
import { h } from "@weftui/core";
import { Effect, Fiber, Scope, Stream, SubscriptionRef } from "effect";
import { JSDOM } from "jsdom";
import { describe, it } from "vite-plus/test";
import { RenderContext } from "~/data";
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
 * Nothing in these tests reads `runtime` or `reportUnhandled`; both are wired
 * to real, harmless implementations rather than stubs so the effect resolves
 * exactly as it would in production.
 */
function makeTestRenderContext(): RenderContext["Service"] {
  const scope = Scope.makeUnsafe("sequential");
  return {
    runtime: WeftApp.make().runtime,
    scope,
    rootScope: scope,
    streamIdCounter: { current: 0 },
    reportUnhandled: () => Effect.void,
  };
}

describe("reactive child attachment (forced, deterministic)", () => {
  it("preserves a first emission that arrives before its markers are attached", async () => {
    createTestDOM();
    const parent = document.createElement("div");
    const startMarker = document.createComment("stream-start-forced");
    const endMarker = document.createComment("stream-end-forced");
    const context = makeTestRenderContext();

    await Effect.runPromise(
      Effect.gen(function* () {
        // `startImmediately` runs the fiber synchronously, in this call, up to
        // its first suspension point. Nothing before the attach-wait loop
        // yields, so the fiber is parked there -- by construction, not by
        // scheduler luck -- once `forkIn` returns.
        const fiber = yield* Effect.forkIn(
          updateStreamChild(startMarker, endMarker, "hello").pipe(
            Effect.provideService(RenderContext, context),
          ),
          context.scope,
          { startImmediately: true },
        );

        // The exact race `handleStreamChild` risks in production: the
        // emission is already mid-flight while the markers are still
        // detached from any parent.
        parent.appendChild(startMarker);
        parent.appendChild(endMarker);

        yield* Fiber.join(fiber);
      }),
    );

    assert.equal(parent.textContent, "hello");
    assert.equal(parent.childNodes.length, 3);
  });

  // The same forced race asserted from the pre-fix side: this body states the
  // old behavior (emission consumed while the markers were detached, region
  // left permanently empty). `it.fails` expects the body to fail, so it stays
  // green while the fix holds. If the attach-wait regresses, the body passes
  // and this reports "expected to fail", a second alarm alongside the
  // positive proof above.
  it.fails("pre-fix behavior: an emission racing marker attachment is dropped, leaving the region empty", async () => {
    createTestDOM();
    const parent = document.createElement("div");
    const startMarker = document.createComment("stream-start-pre-fix");
    const endMarker = document.createComment("stream-end-pre-fix");
    const context = makeTestRenderContext();

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkIn(
          updateStreamChild(startMarker, endMarker, "hello").pipe(
            Effect.provideService(RenderContext, context),
          ),
          context.scope,
          { startImmediately: true },
        );

        parent.appendChild(startMarker);
        parent.appendChild(endMarker);

        yield* Fiber.join(fiber);
      }),
    );

    // The pre-fix signature: both markers attached, the emission gone.
    assert.equal(parent.childNodes.length, 2);
    assert.equal(parent.textContent, "");
  });

  it("terminates instead of hanging when the markers are never attached", async () => {
    createTestDOM();
    const startMarker = document.createComment("stream-start-orphan");
    const endMarker = document.createComment("stream-end-orphan");
    const context = makeTestRenderContext();

    // No parent is ever created. An unbounded attach-wait would hang this
    // test until the timeout below fails it; MARKER_ATTACH_YIELDS caps the
    // wait, so the effect completes and falls back to the existing
    // null-parent guard instead.
    await Effect.runPromise(
      updateStreamChild(startMarker, endMarker, "hello").pipe(
        Effect.provideService(RenderContext, context),
      ),
    );

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
