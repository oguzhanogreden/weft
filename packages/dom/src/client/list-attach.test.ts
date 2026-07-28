/**
 * Regression: a keyed list's first emission must survive its region markers not
 * being attached yet.
 *
 * `renderList` forks the `of` pump before returning its region for the caller
 * to splice into the parent. Pre-fix, a first emission arriving while
 * `regionEnd.parentNode` was still null skipped the entire insertion pass but
 * committed its `ItemRecord`s anyway. The next emission's key-reuse then fed
 * the LIS a fully ascending sequence, so every retained item was skipped and
 * never inserted: the list stayed permanently empty. Worse, an emission adding
 * a new key anchored its `insertBefore` on a marker that was never placed,
 * throwing `NotFoundError` and killing the pump fiber.
 *
 * The tests below force that ordering deterministically: render the region via
 * `renderNode`, let the pump process the first emission, and only then splice
 * the region in, exactly as `mount` does.
 */

import * as assert from "node:assert/strict";
import { h, List } from "@weftui/core";
import { Effect, Scope, SubscriptionRef } from "effect";
import { JSDOM } from "jsdom";
import { describe, it } from "vite-plus/test";
import { RenderContext } from "~/data";
import { renderNode } from "./render";
import * as WeftApp from "./weft-app";

function createTestDOM() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Comment = dom.window.Comment;
  global.Text = dom.window.Text;
  return dom;
}

/** Minimal `RenderContext`, mirroring `stream-child-attach.test.ts`. */
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

interface Item {
  readonly id: string;
  readonly name: string;
}

const items = (ids: readonly string[]): readonly Item[] =>
  ids.map((id) => ({ id, name: id.toUpperCase() }));

/**
 * Renders a `List.each` region fed by `ref`, lets the pump process the first
 * emission while the region is still detached, then splices the region into
 * `root` the way `mount` does. Returns the ref for follow-up emissions.
 */
const mountRacedList = (root: HTMLElement) =>
  Effect.gen(function* () {
    const context = makeTestRenderContext();
    const ref = yield* SubscriptionRef.make(items(["a", "b", "c"]));

    const region = yield* renderNode(
      List.each({ of: SubscriptionRef.changes(ref), by: (x) => x.id }, (x) =>
        h.li({ id: x.id }, x.name),
      ) as never,
    ).pipe(Effect.provideService(RenderContext, context));

    // Let the pump run the first emission before the region is spliced in:
    // the exact ordering `renderList` risks in production.
    yield* Effect.sleep("50 millis");

    // The splice, as `mount` performs it.
    if (region !== null) {
      if (Array.isArray(region)) {
        for (const node of region) root.appendChild(node as Node);
      } else {
        root.appendChild(region as Node);
      }
    }

    return ref;
  });

/** Ordered text of the list items currently under `root`. */
function itemTexts(root: HTMLElement): string[] {
  return [...root.querySelectorAll("li")].map((li) => li.textContent ?? "");
}

describe("keyed list attachment (forced, deterministic)", () => {
  it("carries a pre-splice first emission into the parent on splice", async () => {
    createTestDOM();
    const root = document.createElement("div");
    document.body.appendChild(root);

    await Effect.runPromise(mountRacedList(root));

    assert.deepEqual(itemTexts(root), ["A", "B", "C"]);
  });

  it("reconciles a reorder-plus-insert second emission after a raced first", async () => {
    // The permanent-loss signature: retained items were never placed, so the
    // LIS reuse path must not skip them, and the new key's insert anchor must
    // be in the DOM (pre-fix this threw NotFoundError and killed the pump).
    createTestDOM();
    const root = document.createElement("div");
    document.body.appendChild(root);

    const ref = await Effect.runPromise(mountRacedList(root));

    await Effect.runPromise(SubscriptionRef.set(ref, items(["c", "a", "d", "b"])));
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.deepEqual(itemTexts(root), ["C", "A", "D", "B"]);
  });
});
