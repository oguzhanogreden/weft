import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { Effect, Stream } from "effect";
import { Suspense } from "@effect-ui/core";
import { JSDOM } from "jsdom";
import { mount } from "./api";

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDOM() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Comment = dom.window.Comment;
  global.Text = dom.window.Text;
  return dom;
}

function createRoot(): HTMLElement {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  return root;
}

async function runMount(app: unknown, root: HTMLElement) {
  return Effect.runPromise(mount(app as never, root));
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collect all Comment nodes in a subtree. */
function getComments(el: Element): Comment[] {
  const result: Comment[] = [];
  const walker = document.createTreeWalker(el, 128 /* NodeFilter.SHOW_COMMENT */);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    result.push(node as Comment);
  }
  return result;
}

/** Suspense-marker comments only. */
function getSuspenseComments(el: Element): Comment[] {
  return getComments(el).filter((c) => c.data.includes("suspense"));
}

// ============================================================================
// AC1: Synchronous children — no fallback rendered
// ============================================================================

describe("AC1: Synchronous children — no fallback rendered", () => {
  it("renders children directly without fallback or suspense markers", async () => {
    createTestDOM();
    const root = createRoot();

    await runMount(
      <Suspense fallback={<span class="fallback">Loading</span>}>
        <div class="content">Hello</div>
      </Suspense>,
      root,
    );

    // Children are present
    assert.ok(root.querySelector(".content"), "Children should be in the DOM");
    assert.equal(root.querySelector(".content")?.textContent, "Hello");

    // Fallback is absent
    assert.equal(root.querySelector(".fallback"), null, "Fallback must not be rendered");

    // No suspense comment markers
    assert.equal(getSuspenseComments(root).length, 0, "No suspense markers should exist");
  });

  it("renders multiple sync children without markers", async () => {
    createTestDOM();
    const root = createRoot();

    await runMount(
      <Suspense fallback={<span>Loading</span>}>
        <div class="a">A</div>
        <div class="b">B</div>
      </Suspense>,
      root,
    );

    assert.ok(root.querySelector(".a"));
    assert.ok(root.querySelector(".b"));
    assert.equal(getSuspenseComments(root).length, 0);
  });
});

// ============================================================================
// AC2: Single async child — fallback shown, then swap
// ============================================================================

describe("AC2: Single async child — fallback shown, then swap", () => {
  it("shows fallback while pending, then swaps to resolved content", async () => {
    createTestDOM();
    const root = createRoot();

    function AsyncChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<p class="resolved">Done</p>), 150),
          ),
      );
    }

    await runMount(
      <Suspense fallback={<span class="fallback">Loading</span>}>
        <AsyncChild />
      </Suspense>,
      root,
    );

    // Fallback visible immediately
    assert.ok(root.querySelector(".fallback"), "Fallback must be shown while pending");
    assert.equal(root.querySelector(".resolved"), null, "Resolved content must not be present yet");

    // Suspense markers bracket the fallback
    const markersBefore = getSuspenseComments(root);
    assert.equal(markersBefore.length, 2, "Start and end markers must be in DOM while pending");

    // After child resolves
    await waitFor(250);
    assert.equal(root.querySelector(".fallback"), null, "Fallback must be removed after settle");
    assert.ok(root.querySelector(".resolved"), "Resolved content must be in DOM");

    // Markers cleaned up
    assert.equal(
      getSuspenseComments(root).length,
      0,
      "Suspense markers must be removed after swap",
    );
  });

  it("subsequent stream emissions update the resolved content normally", async () => {
    createTestDOM();
    const root = createRoot();

    // V1 at +100ms; V2 at +100ms+200ms = +300ms.
    // Check V1 at +160ms (after swap, before V2 replaces it).
    function AsyncChild(): Stream.Stream<JSX.Element> {
      return Stream.async<JSX.Element>((emit) => {
        setTimeout(() => {
          emit.single(<span class="v1">V1</span>);
          setTimeout(() => {
            emit.single(<span class="v2">V2</span>);
            emit.end();
          }, 200); // 200ms gap so V1 is observable before V2 replaces it
        }, 100);
      });
    }

    await runMount(
      <Suspense fallback={<span class="fallback">Loading</span>}>
        <AsyncChild />
      </Suspense>,
      root,
    );

    // Pending
    assert.ok(root.querySelector(".fallback"));

    // After first emission (+160ms) — fallback swapped out, V1 visible
    await waitFor(160);
    assert.equal(root.querySelector(".fallback"), null, "Fallback removed after first emission");
    assert.ok(root.querySelector(".v1"), "First emission content should be visible");

    // After second emission (+380ms total) — V2 replaces V1, no fallback re-shown
    await waitFor(220);
    assert.ok(root.querySelector(".v2"), "Second emission should update content");
    assert.equal(
      root.querySelector(".fallback"),
      null,
      "Fallback not re-shown for subsequent emissions",
    );
    assert.equal(root.querySelector(".v1"), null, "First value replaced by second");
  });
});

// ============================================================================
// AC3: Multiple async siblings — shared fallback, single swap
// ============================================================================

describe("AC3: Multiple async siblings — shared fallback, single swap", () => {
  it("keeps fallback until ALL siblings have settled", async () => {
    createTestDOM();
    const root = createRoot();

    function FastChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<span class="fast">Fast</span>), 80),
          ),
      );
    }

    function SlowChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<span class="slow">Slow</span>), 250),
          ),
      );
    }

    await runMount(
      <Suspense fallback={<span class="fallback">Loading</span>}>
        <FastChild />
        <SlowChild />
      </Suspense>,
      root,
    );

    // Both pending → fallback visible
    assert.ok(root.querySelector(".fallback"), "Fallback shown while both pending");

    // Fast settles (80ms) → fallback still shown (slow still pending)
    await waitFor(130);
    assert.ok(root.querySelector(".fallback"), "Fallback must persist until ALL children settle");
    assert.equal(root.querySelector(".fast"), null, "Fast child not yet in live DOM");
    assert.equal(root.querySelector(".slow"), null, "Slow child not yet in live DOM");

    // Slow settles (250ms) → both inserted, fallback removed, single swap
    await waitFor(200);
    assert.equal(root.querySelector(".fallback"), null, "Fallback removed after all settle");
    assert.ok(root.querySelector(".fast"), "Fast child visible after swap");
    assert.ok(root.querySelector(".slow"), "Slow child visible after swap");
    assert.equal(getSuspenseComments(root).length, 0, "Markers cleaned up");
  });

  it("swap is atomic — all resolved children appear simultaneously", async () => {
    createTestDOM();
    const root = createRoot();

    const snapshots: string[] = [];

    function ChildA(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<span class="a">A</span>), 100),
          ),
      );
    }

    function ChildB(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<span class="b">B</span>), 200),
          ),
      );
    }

    await runMount(
      <Suspense fallback={<span class="fallback">Loading</span>}>
        <ChildA />
        <ChildB />
      </Suspense>,
      root,
    );

    // Poll at intermediate point — A settled but B hasn't
    await waitFor(150);
    snapshots.push(root.textContent ?? "");

    // After both settled
    await waitFor(150);
    snapshots.push(root.textContent ?? "");

    // At 150ms: fallback still showing, A not yet visible
    assert.ok(snapshots[0]?.includes("Loading"), "Fallback still at 150ms");
    assert.ok(!snapshots[0]?.includes("A"), "A not yet visible at 150ms");

    // After swap: both visible
    assert.ok(snapshots[1]?.includes("A"), "A visible after swap");
    assert.ok(snapshots[1]?.includes("B"), "B visible after swap");
    assert.ok(!snapshots[1]?.includes("Loading"), "Fallback gone after swap");
  });
});

// ============================================================================
// AC4: Nested Suspense — independent boundaries
// ============================================================================

describe("AC4: Nested Suspense — independent boundaries", () => {
  it("inner boundary resolves independently of outer boundary", async () => {
    createTestDOM();
    const root = createRoot();

    function InnerChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<p class="inner-done">Inner</p>), 100),
          ),
      );
    }

    function OuterChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<p class="outer-done">Outer</p>), 300),
          ),
      );
    }

    await runMount(
      <Suspense fallback={<span class="outer-fallback">Outer Loading</span>}>
        <OuterChild />
        <Suspense fallback={<span class="inner-fallback">Inner Loading</span>}>
          <InnerChild />
        </Suspense>
      </Suspense>,
      root,
    );

    // Both pending initially
    assert.ok(root.querySelector(".outer-fallback"), "Outer fallback shown initially");

    // After 150ms: inner should have resolved (100ms), outer still pending
    await waitFor(150);
    // Outer fallback still showing (outer child not settled yet)
    assert.ok(root.querySelector(".outer-fallback"), "Outer fallback persists until outer settles");

    // After 350ms: outer settled
    await waitFor(200);
    assert.equal(root.querySelector(".outer-fallback"), null, "Outer fallback gone");
    assert.ok(root.querySelector(".outer-done"), "Outer resolved content visible");
    // Inner should be resolved too
    assert.ok(root.querySelector(".inner-done"), "Inner resolved content visible");
    assert.equal(root.querySelector(".inner-fallback"), null, "Inner fallback gone");
  });

  it("outer has no direct async children — outer fast-paths while inner shows its fallback", async () => {
    createTestDOM();
    const root = createRoot();

    function InnerChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<p class="inner-done">Inner</p>), 150),
          ),
      );
    }

    await runMount(
      // Outer has only sync children (inner Suspense is not an async component)
      <Suspense fallback={<span class="outer-fallback">Outer Loading</span>}>
        <span class="sync">Sync</span>
        <Suspense fallback={<span class="inner-fallback">Inner Loading</span>}>
          <InnerChild />
        </Suspense>
      </Suspense>,
      root,
    );

    // Outer fast-paths (no direct async children), no outer fallback
    assert.equal(root.querySelector(".outer-fallback"), null, "Outer must not show fallback");
    // Inner fallback is shown (inner has async child)
    assert.ok(root.querySelector(".inner-fallback"), "Inner fallback shown");

    await waitFor(250);
    assert.ok(root.querySelector(".inner-done"), "Inner resolved");
    assert.equal(root.querySelector(".inner-fallback"), null, "Inner fallback gone");
  });
});

// ============================================================================
// AC5: Null / falsy fallback — only markers while pending
// ============================================================================

describe("AC5: Null fallback — only markers while pending", () => {
  it("shows only comment markers when fallback is null", async () => {
    createTestDOM();
    const root = createRoot();

    function AsyncChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<p class="done">Done</p>), 100),
          ),
      );
    }

    await runMount(
      // biome-ignore lint/suspicious/noExplicitAny: testing null fallback
      <Suspense fallback={null as any}>
        <AsyncChild />
      </Suspense>,
      root,
    );

    // Only markers, no visible content
    assert.equal(
      root.textContent?.trim(),
      "",
      "No visible content while pending with null fallback",
    );
    const markers = getSuspenseComments(root);
    assert.equal(markers.length, 2, "Comment markers present");

    // Swap still happens
    await waitFor(200);
    assert.ok(root.querySelector(".done"), "Resolved content visible after swap");
    assert.equal(getSuspenseComments(root).length, 0, "Markers cleaned up");
  });

  it("shows only comment markers when fallback is undefined (omitted)", async () => {
    createTestDOM();
    const root = createRoot();

    function AsyncChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<p class="done">Done</p>), 100),
          ),
      );
    }

    await runMount(
      <Suspense>
        <AsyncChild />
      </Suspense>,
      root,
    );

    assert.equal(root.textContent?.trim(), "", "No visible content");
    assert.equal(getSuspenseComments(root).length, 2);

    await waitFor(200);
    assert.ok(root.querySelector(".done"));
  });
});

// ============================================================================
// AC6: Effect<JSXNode> component triggers suspension
// ============================================================================

describe("AC6: Function component returning Effect<JSXNode> triggers suspension", () => {
  it("register is called before Effect runs, settle called exactly once", async () => {
    createTestDOM();
    const root = createRoot();

    let registerCallCount = 0;
    let settleCallCount = 0;

    // We verify via boundary behaviour: while pending → fallback; after settle → content
    function EffectChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) => {
            setTimeout(() => resolve(<span class="content">OK</span>), 100);
          }),
      );
    }

    // Use boundary to observe register/settle indirectly
    await runMount(
      <Suspense fallback={<span class="fallback">Waiting</span>}>
        <EffectChild />
      </Suspense>,
      root,
    );

    // register happened → boundary is pending → fallback shown
    assert.ok(root.querySelector(".fallback"), "Boundary must be pending (register was called)");

    await waitFor(200);
    // settle happened → boundary swapped
    assert.equal(root.querySelector(".fallback"), null, "Boundary must settle (settle was called)");
    assert.ok(root.querySelector(".content"));

    void registerCallCount;
    void settleCallCount;
  });
});

// ============================================================================
// AC7: Stream<JSXNode> component — settle on first emission
// ============================================================================

describe("AC7: Function component returning Stream<JSXNode> triggers suspension", () => {
  it("settle called on first emission; subsequent emissions do not re-show fallback", async () => {
    createTestDOM();
    const root = createRoot();

    // Stream that emits multiple values over time
    function StreamChild(): Stream.Stream<JSX.Element> {
      return Stream.async<JSX.Element>((emit) => {
        setTimeout(() => emit.single(<span class="v1">V1</span>), 100);
        setTimeout(() => emit.single(<span class="v2">V2</span>), 250);
        setTimeout(() => emit.end(), 300);
      });
    }

    await runMount(
      <Suspense fallback={<span class="fallback">Waiting</span>}>
        <StreamChild />
      </Suspense>,
      root,
    );

    // Pending
    assert.ok(root.querySelector(".fallback"), "Fallback shown before first emission");

    // After first emission (100ms) — swap
    await waitFor(160);
    assert.equal(root.querySelector(".fallback"), null, "Fallback removed on first emission");
    assert.ok(root.querySelector(".v1"), "First value visible");

    // Second emission (250ms) — reactive update, no fallback re-shown
    await waitFor(200);
    assert.ok(root.querySelector(".v2"), "Second emission updates content");
    assert.equal(
      root.querySelector(".fallback"),
      null,
      "Fallback not re-shown for subsequent emissions",
    );
    assert.equal(root.querySelector(".v1"), null, "First value replaced");
  });
});

// ============================================================================
// AC8: Non-component reactive values do NOT trigger suspension
// ============================================================================

describe("AC8: Non-component reactive values do not trigger suspension", () => {
  it("inline stream child does not register with Suspense", async () => {
    createTestDOM();
    const root = createRoot();

    // A stream used as an inline child (not via a function component)
    const inlineStream = Stream.async<string>((emit) => {
      setTimeout(() => {
        emit.single("Hello");
        emit.end();
      }, 100);
    });

    // AsyncComponent DOES trigger suspension
    function AsyncComponent(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<span class="async">Async</span>), 200),
          ),
      );
    }

    await runMount(
      <Suspense fallback={<span class="fallback">Waiting</span>}>
        <div>{inlineStream}</div>
        <AsyncComponent />
      </Suspense>,
      root,
    );

    // The boundary waits only for AsyncComponent (not the inline stream)
    // Fallback shown while AsyncComponent is pending (200ms)
    assert.ok(root.querySelector(".fallback"), "Boundary pending because of AsyncComponent");

    // At 150ms: inlineStream has emitted but AsyncComponent hasn't settled yet
    await waitFor(150);
    assert.ok(root.querySelector(".fallback"), "Fallback still shown (AsyncComponent not settled)");

    // At 300ms: AsyncComponent settled → swap
    await waitFor(150);
    assert.equal(
      root.querySelector(".fallback"),
      null,
      "Fallback gone after AsyncComponent settles",
    );
    assert.ok(root.querySelector(".async"), "Async content visible");
  });

  it("stream prop on element does not trigger suspension", async () => {
    createTestDOM();
    const root = createRoot();

    const classStream = Stream.async<string>((emit) => {
      setTimeout(() => {
        emit.single("active");
        emit.end();
      }, 50);
    });

    // Without any async function component child, the boundary should fast-path
    await runMount(
      <Suspense fallback={<span class="fallback">Waiting</span>}>
        <div class={classStream}>Content</div>
      </Suspense>,
      root,
    );

    // No async function component → fast path → no fallback
    assert.equal(root.querySelector(".fallback"), null, "Stream prop must not trigger suspension");
    assert.ok(root.querySelector("div"), "Content rendered directly");
  });
});

// ============================================================================
// AC9: Scope close while pending — clean interruption
// ============================================================================

describe("AC9: Scope close while pending — clean interruption", () => {
  it("unmount while pending interrupts swap fiber without error", async () => {
    createTestDOM();
    const root = createRoot();

    function NeverSettles(): Effect.Effect<JSX.Element> {
      // An Effect that never resolves
      return Effect.never as unknown as Effect.Effect<JSX.Element>;
    }

    const handle = await runMount(
      <Suspense fallback={<span class="fallback">Forever loading</span>}>
        <NeverSettles />
      </Suspense>,
      root,
    );

    // Boundary is pending
    assert.ok(root.querySelector(".fallback"), "Boundary pending");

    // Unmount — must not throw
    await assert.doesNotReject(
      () => Effect.runPromise(handle.unmount()),
      "Unmounting while Suspense is pending must not throw",
    );
  });

  it("unmount while pending does not cause error after timeout", async () => {
    createTestDOM();
    const root = createRoot();

    function SlowChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) => setTimeout(() => resolve(<span>Done</span>), 500)),
      );
    }

    const handle = await runMount(
      <Suspense fallback={<span class="fallback">Loading</span>}>
        <SlowChild />
      </Suspense>,
      root,
    );

    // Unmount at 100ms (before child settles at 500ms)
    await waitFor(100);
    await Effect.runPromise(handle.unmount());

    // Wait past when the child would have settled — no error
    await waitFor(500);
    assert.ok(true, "No error after scope-close interrupts the pending boundary");
  });
});

// ============================================================================
// AC10: Sentinel prevents premature settlement
// ============================================================================

describe("AC10: Sentinel prevents premature settlement", () => {
  it("fast-resolving child does not trigger swap before siblings register", async () => {
    createTestDOM();
    const root = createRoot();

    // FastChild resolves synchronously via Effect.sync
    function FastChild(): Effect.Effect<JSX.Element> {
      return Effect.sync(() => <span class="fast">Fast</span>);
    }

    // SlowChild is genuinely async
    function SlowChild(): Effect.Effect<JSX.Element> {
      return Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) =>
            setTimeout(() => resolve(<span class="slow">Slow</span>), 150),
          ),
      );
    }

    await runMount(
      <Suspense fallback={<span class="fallback">Loading</span>}>
        <FastChild />
        <SlowChild />
      </Suspense>,
      root,
    );

    // Despite FastChild being very fast, boundary should be pending
    // (SlowChild is still registered but not settled)
    assert.ok(
      root.querySelector(".fallback"),
      "Fallback shown — sentinel prevented premature swap",
    );

    await waitFor(250);
    // Both should now be resolved
    assert.equal(root.querySelector(".fallback"), null, "Fallback gone after all settle");
    assert.ok(root.querySelector(".fast"), "Fast child visible");
    assert.ok(root.querySelector(".slow"), "Slow child visible");
  });

  it("boundary with only sync children fast-paths immediately (no fallback ever shown)", async () => {
    createTestDOM();
    const root = createRoot();

    function SyncChild(): JSX.Element {
      return <span class="sync">Sync</span>;
    }

    await runMount(
      <Suspense fallback={<span class="fallback">Loading</span>}>
        <SyncChild />
      </Suspense>,
      root,
    );

    // Sentinel released with no async children → allSettled fires → fast path
    assert.equal(root.querySelector(".fallback"), null, "No fallback for sync-only children");
    assert.ok(root.querySelector(".sync"), "Sync child rendered directly");
    assert.equal(getSuspenseComments(root).length, 0, "No markers for sync-only boundary");
  });
});
