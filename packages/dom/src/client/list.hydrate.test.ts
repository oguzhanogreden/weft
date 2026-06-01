import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { Data, Effect, Stream, SubscriptionRef } from "effect";
import { h, List } from "@effect-ui/core";
import type { Renderable } from "@effect-ui/core/types";
import { JSDOM } from "jsdom";
import { hydrate } from "./render";
import { renderToString, renderToStringHydratable } from "~/server";

// ============================================================================
// Test setup (mirrors hydrate.test.ts / list.test.ts)
// ============================================================================

function createTestDOM(): JSDOM {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Comment = dom.window.Comment;
  global.Text = dom.window.Text;
  return dom;
}

function createRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

/** Renders `app` to hydratable HTML and seeds it into a fresh root. */
async function seedServerHtml(app: Renderable): Promise<HTMLElement> {
  const root = createRoot();
  const html = await Effect.runPromise(renderToStringHydratable(app));
  root.innerHTML = html;
  return root;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const waitForStream = () => waitFor(100);
const waitForStreamUpdate = () => waitFor(150);

interface Person {
  readonly id: string;
  readonly name: string;
}

const p = (id: string, name = id.toUpperCase()): Person => ({ id, name });

/** Ordered `id` attributes of the `<li>` items currently in the DOM. */
function itemIds(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("li")).map((li) => li.id);
}

/** All comment-marker text data under `root`, in document order. */
function commentData(root: HTMLElement): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, 128 /* SHOW_COMMENT */);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    out.push((n as Comment).data);
  }
  return out;
}

class PersonData extends Data.Class<{ readonly id: string; readonly name: string }> {}

// ============================================================================
// HY1: server markers
// ============================================================================

describe("List.each hydration — HY1 server markers", () => {
  it("brackets the region and each item with stream + list-item markers", async () => {
    const app = List.each({ of: [p("a"), p("b")], by: (x) => x.id }, (x) =>
      h.li({ id: x.id }, x.name),
    );
    const html = await Effect.runPromise(renderToStringHydratable(app));
    assert.equal(
      html,
      "<!-- stream-start-1 -->" +
        '<!-- list-item-start-2 --><li id="a">A</li><!-- list-item-end-2 -->' +
        '<!-- list-item-start-3 --><li id="b">B</li><!-- list-item-end-3 -->' +
        "<!-- stream-end-1 -->",
    );
  });

  it("plain renderToString emits the items inline with no markers", async () => {
    const app = List.each({ of: [p("a"), p("b")], by: (x) => x.id }, (x) =>
      h.li({ id: x.id }, x.name),
    );
    const html = await Effect.runPromise(renderToString(app));
    assert.equal(html, '<li id="a">A</li><li id="b">B</li>');
  });

  it("emits an empty region (only stream markers) for an empty list", async () => {
    const app = List.each({ of: [] as Person[], by: (x) => x.id }, (x) =>
      h.li({ id: x.id }, x.name),
    );
    const html = await Effect.runPromise(renderToStringHydratable(app));
    assert.equal(html, "<!-- stream-start-1 --><!-- stream-end-1 -->");
  });
});

// ============================================================================
// HY2: adopt + flash-free first emission
// ============================================================================

describe("List.each hydration — HY2 flash-free adoption", () => {
  it("adopts server item nodes in place (identity preserved, render once per key)", async () => {
    createTestDOM();
    let renders = 0;
    const app = List.each({ of: [p("a"), p("b")], by: (x) => x.id }, (x) => {
      renders++;
      return h.li({ id: x.id }, x.name);
    });
    const root = await seedServerHtml(app);

    // Tag the server-rendered nodes so we can tell adoption from re-creation.
    const serverA = root.querySelector("#a");
    const serverB = root.querySelector("#b");
    assert.ok(serverA && serverB);
    (serverA as unknown as { __sentinel?: boolean }).__sentinel = true;

    // Discount the server-side render invocations; count only client hydration.
    renders = 0;

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();

    assert.deepEqual(itemIds(root), ["a", "b"]);
    assert.strictEqual(root.querySelector("#a"), serverA, "a adopted, not re-created");
    assert.strictEqual(root.querySelector("#b"), serverB, "b adopted, not re-created");
    assert.equal(
      (root.querySelector("#a") as unknown as { __sentinel?: boolean }).__sentinel,
      true,
    );
    assert.equal(renders, 2, "render invoked exactly once per key during hydration");
  });

  it("attaches a per-item reactive subscription that stays live after hydration", async () => {
    createTestDOM();
    const counter = await Effect.runPromise(SubscriptionRef.make(0));
    const app = List.each({ of: [p("a"), p("b")], by: (x) => x.id }, (x) =>
      x.id === "a" ? h.li({ id: x.id }, [counter.changes]) : h.li({ id: x.id }, x.name),
    );
    const root = await seedServerHtml(app);

    // Server rendered the counter's first value inside a nested reactive region.
    const serverA = root.querySelector("#a");
    assert.ok(serverA);
    assert.equal(serverA.textContent, "0");

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();

    // Subscription attached to the adopted node — a new emission updates it.
    await Effect.runPromise(SubscriptionRef.set(counter, 7));
    await waitForStreamUpdate();

    assert.strictEqual(root.querySelector("#a"), serverA, "node identity preserved");
    assert.equal(root.querySelector("#a")?.textContent, "7", "subscription is live post-hydrate");
  });

  it("reconciles later emissions against the adopted records (insert + reorder)", async () => {
    createTestDOM();
    let renders = 0;
    const ref = await Effect.runPromise(SubscriptionRef.make<readonly Person[]>([p("a"), p("b")]));
    const app = List.each({ of: ref.changes, by: (x) => x.id }, (x) => {
      renders++;
      return h.li({ id: x.id }, x.name);
    });
    const root = await seedServerHtml(app);

    // Discount server-side render invocations; count only client-side work.
    renders = 0;

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();
    assert.deepEqual(itemIds(root), ["a", "b"]);
    assert.equal(renders, 2, "only the adopted items rendered so far");

    const a0 = root.querySelector("#a");
    const b0 = root.querySelector("#b");

    // Insert a new key — only it renders; adopted nodes keep identity.
    await Effect.runPromise(SubscriptionRef.set(ref, [p("a"), p("x"), p("b")]));
    await waitForStreamUpdate();

    assert.deepEqual(itemIds(root), ["a", "x", "b"]);
    assert.equal(renders, 3, "only the new key x rendered");
    assert.strictEqual(root.querySelector("#a"), a0, "a kept its adopted node");
    assert.strictEqual(root.querySelector("#b"), b0, "b kept its adopted node");

    // Reorder — no new renders, identity preserved.
    await Effect.runPromise(SubscriptionRef.set(ref, [p("b"), p("x"), p("a")]));
    await waitForStreamUpdate();
    assert.deepEqual(itemIds(root), ["b", "x", "a"]);
    assert.equal(renders, 3, "reorder re-renders nothing");
    assert.strictEqual(root.querySelector("#a"), a0);
    assert.strictEqual(root.querySelector("#b"), b0);
  });

  it("removes a dropped key's adopted DOM and interrupts its subscription", async () => {
    createTestDOM();
    const cancelled = new Set<string>();
    const itemStream = (id: string) =>
      Stream.concat(Stream.make(id), Stream.never).pipe(
        Stream.ensuring(Effect.sync(() => cancelled.add(id))),
      );
    const ref = await Effect.runPromise(
      SubscriptionRef.make<readonly Person[]>([p("a"), p("b"), p("c")]),
    );
    const app = List.each({ of: ref.changes, by: (x) => x.id }, (x) =>
      h.li({ id: x.id }, [itemStream(x.id)]),
    );
    const root = await seedServerHtml(app);

    // The server `runHead`s each item stream (firing its `ensuring`) to render
    // the first value; clear that so we observe only client-side teardown.
    cancelled.clear();

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();
    assert.deepEqual(itemIds(root), ["a", "b", "c"]);
    assert.equal(cancelled.size, 0, "adopted subscriptions stay live after hydration");

    await Effect.runPromise(SubscriptionRef.set(ref, [p("a"), p("c")]));
    await waitForStreamUpdate();

    assert.deepEqual(itemIds(root), ["a", "c"]);
    assert.deepEqual([...cancelled], ["b"], "only the dropped item's subscription was interrupted");
  });

  it("teardown closes every adopted item scope (subscriptions interrupted)", async () => {
    createTestDOM();
    const cancelled = new Set<string>();
    const itemStream = (id: string) =>
      Stream.concat(Stream.make(id), Stream.never).pipe(
        Stream.ensuring(Effect.sync(() => cancelled.add(id))),
      );
    const app = List.each({ of: [p("a"), p("b"), p("c")], by: (x) => x.id }, (x) =>
      h.li({ id: x.id }, [itemStream(x.id)]),
    );
    const root = await seedServerHtml(app);

    // Server `runHead` already fired each finalizer; observe only client teardown.
    cancelled.clear();

    const handle = await Effect.runPromise(hydrate(app, root));
    await waitForStream();
    assert.equal(cancelled.size, 0, "adopted subscriptions stay live after hydration");

    await Effect.runPromise(handle.unmount());
    assert.deepEqual([...cancelled].sort(), ["a", "b", "c"]);
  });
});

// ============================================================================
// HY2: graceful divergence
// ============================================================================

describe("List.each hydration — HY2 divergence", () => {
  it("rebuilds and logs when the server item count differs from the first emission", async () => {
    createTestDOM();
    const root = createRoot();
    // Server rendered a single item; the app's first emission has two.
    root.innerHTML =
      "<!-- stream-start-1 -->" +
      '<!-- list-item-start-2 --><li id="a">A</li><!-- list-item-end-2 -->' +
      "<!-- stream-end-1 -->";

    const app = List.each({ of: [p("a"), p("b")], by: (x) => x.id }, (x) =>
      h.li({ id: x.id }, x.name),
    );

    const originalError = console.error;
    let errorCalls = 0;
    console.error = () => {
      errorCalls++;
    };
    try {
      const exit = await Effect.runPromiseExit(hydrate(app, root));
      await waitForStream();
      assert.ok(exit._tag === "Success", "divergence is recoverable (no failure)");
      assert.deepEqual(itemIds(root), ["a", "b"], "region rebuilt to the correct first emission");
      assert.equal(errorCalls, 1, "divergence was reported once");
    } finally {
      console.error = originalError;
    }
  });

  it("patches a single item whose content diverges, keeping its markers", async () => {
    createTestDOM();
    const root = createRoot();
    // Item count matches (1), but the item's interior diverges (<span> vs <li>).
    root.innerHTML =
      "<!-- stream-start-1 -->" +
      '<!-- list-item-start-2 --><span id="a">STALE</span><!-- list-item-end-2 -->' +
      "<!-- stream-end-1 -->";

    const app = List.each({ of: [p("a")], by: (x) => x.id }, (x) => h.li({ id: x.id }, x.name));

    const originalError = console.error;
    let errorCalls = 0;
    console.error = () => {
      errorCalls++;
    };
    try {
      const exit = await Effect.runPromiseExit(hydrate(app, root));
      await waitForStream();
      assert.ok(exit._tag === "Success");
      assert.deepEqual(itemIds(root), ["a"], "item patched to the correct element");
      assert.equal(root.querySelector("#a")?.textContent, "A");
      assert.equal(errorCalls, 1, "per-item divergence reported once");
    } finally {
      console.error = originalError;
    }
  });
});

// ============================================================================
// HY2: nested lists (depth-aware item-range adoption)
// ============================================================================

describe("List.each hydration — HY2 nested lists", () => {
  it("adopts a nested List.each inside an item without losing outer/inner identity", async () => {
    createTestDOM();
    const app = List.each({ of: [p("a"), p("b")], by: (x) => x.id }, (x) =>
      h.ul({ id: `outer-${x.id}` }, [
        List.each({ of: [p(`${x.id}1`), p(`${x.id}2`)], by: (y) => y.id }, (y) =>
          h.li({ id: y.id }, y.name),
        ),
      ]),
    );
    const root = await seedServerHtml(app);

    // Tag the server nodes so we can prove adoption vs re-creation.
    const outerA = root.querySelector("#outer-a");
    const innerA1 = root.querySelector("#a1");
    assert.ok(outerA && innerA1);

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();

    // `collectAdoptedItems` stepped over the nested list-item markers (depth) so
    // each outer item's range was bounded correctly — both levels adopted in place.
    assert.deepEqual(itemIds(root), ["a1", "a2", "b1", "b2"]);
    assert.strictEqual(root.querySelector("#outer-a"), outerA, "outer item adopted, not rebuilt");
    assert.strictEqual(root.querySelector("#a1"), innerA1, "nested item adopted, not rebuilt");
  });
});

// ============================================================================
// HY2: marker-id stability after hydration
// ============================================================================

describe("List.each hydration — HY2 marker id stability", () => {
  it("post-hydration inserts mint marker ids that don't collide with adopted ones", async () => {
    createTestDOM();
    const ref = await Effect.runPromise(SubscriptionRef.make<readonly Person[]>([p("a"), p("b")]));
    const app = List.each({ of: ref.changes, by: (x) => x.id }, (x) => h.li({ id: x.id }, x.name));
    const root = await seedServerHtml(app);

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();

    // Insert a new key after hydration — its fresh markers must be unique.
    await Effect.runPromise(SubscriptionRef.set(ref, [p("a"), p("c"), p("b")]));
    await waitForStreamUpdate();
    assert.deepEqual(itemIds(root), ["a", "c", "b"]);

    const itemStarts = commentData(root).filter((d) => d.includes("list-item-start"));
    assert.equal(itemStarts.length, 3);
    assert.equal(
      new Set(itemStarts).size,
      itemStarts.length,
      "every list-item-start marker id is unique (counter seeded past adopted ids)",
    );
  });
});

// ============================================================================
// HY2: additional source/identity coverage
// ============================================================================

describe("List.each hydration — HY2 source & identity coverage", () => {
  it("hydrates an empty server region and inserts on a later emission", async () => {
    createTestDOM();
    const ref = await Effect.runPromise(SubscriptionRef.make<readonly Person[]>([]));
    const app = List.each({ of: ref.changes, by: (x) => x.id }, (x) => h.li({ id: x.id }, x.name));
    const root = await seedServerHtml(app);
    assert.equal(commentData(root).filter((d) => d.includes("list-item-start")).length, 0);

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();
    assert.deepEqual(itemIds(root), []);

    await Effect.runPromise(SubscriptionRef.set(ref, [p("a"), p("b")]));
    await waitForStreamUpdate();
    assert.deepEqual(itemIds(root), ["a", "b"]);
  });

  it("hydrates with `by` omitted (structural Data identity), reusing equal items", async () => {
    createTestDOM();
    let renders = 0;
    const ref = await Effect.runPromise(
      SubscriptionRef.make<readonly PersonData[]>([new PersonData({ id: "a", name: "Ann" })]),
    );
    const app = List.each({ of: ref.changes }, (x) => {
      renders++;
      return h.li({ id: x.id }, x.name);
    });
    const root = await seedServerHtml(app);
    renders = 0;

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();
    assert.equal(renders, 1, "render invoked once per key during hydration");
    const a0 = root.querySelector("#a");

    // A fresh, structurally-equal instance reconciles to the same key.
    await Effect.runPromise(SubscriptionRef.set(ref, [new PersonData({ id: "a", name: "Ann" })]));
    await waitForStreamUpdate();
    assert.equal(renders, 1, "structurally-equal Data item reused (no re-render)");
    assert.strictEqual(root.querySelector("#a"), a0, "adopted node identity preserved");
  });

  it("hydrates a Stream `of` (first emission via await-first get on the server)", async () => {
    createTestDOM();
    const app = List.each(
      { of: Stream.succeed([p("a"), p("b")] as readonly Person[]), by: (x) => x.id },
      (x) => h.li({ id: x.id }, x.name),
    );
    const root = await seedServerHtml(app);
    const a0 = root.querySelector("#a");
    assert.ok(a0);

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();

    assert.deepEqual(itemIds(root), ["a", "b"]);
    assert.strictEqual(
      root.querySelector("#a"),
      a0,
      "Stream-sourced first emission adopted in place",
    );
  });

  it("SC2: focus and uncontrolled input value survive a post-hydration reorder", async () => {
    createTestDOM();
    const ref = await Effect.runPromise(SubscriptionRef.make<readonly Person[]>([p("a"), p("b")]));
    const app = List.each({ of: ref.changes, by: (x) => x.id }, (x) =>
      h.li({ id: x.id }, [h.input({ id: `input-${x.id}` })]),
    );
    const root = await seedServerHtml(app);

    await Effect.runPromise(hydrate(app, root));
    await waitForStream();

    // Interact with the adopted input, then reorder.
    const input = root.querySelector<HTMLInputElement>("#input-a")!;
    input.value = "typed text";
    input.focus();
    assert.strictEqual(document.activeElement, input);

    await Effect.runPromise(SubscriptionRef.set(ref, [p("b"), p("a")]));
    await waitForStreamUpdate();

    assert.deepEqual(itemIds(root), ["b", "a"]);
    const after = root.querySelector<HTMLInputElement>("#input-a")!;
    assert.strictEqual(after, input, "the adopted input node was moved, not recreated");
    assert.equal(after.value, "typed text", "uncontrolled value preserved");
    assert.strictEqual(document.activeElement, after, "focus preserved");
  });
});
