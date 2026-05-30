import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { Cause, Data, Deferred, Effect, Logger, LogLevel, Option, Stream } from "effect";
import { Boundary, h } from "@effect-ui/core";
import type { Child } from "@effect-ui/core";
import type { RenderNode } from "@effect-ui/core/types";
import { JSDOM } from "jsdom";
import { mount } from "./render";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function runMount(app: RenderNode, root: HTMLElement) {
  return Effect.runPromise(mount(app, root));
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBoundaryComments(el: Element): Comment[] {
  const result: Comment[] = [];
  const walker = document.createTreeWalker(el, 128);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const c = node as Comment;
    if (c.data.includes("boundary")) result.push(c);
  }
  return result;
}

/**
 * Runs `mount` with a replacement logger that records every `Error`-level log
 * entry's `Cause`, so tests can assert that an unhandled boundary failure was
 * surfaced (rather than silently swallowed). Returns the mount handle and the
 * captured causes (populated asynchronously as post-mount failures occur).
 */
async function runMountCapturingErrors(app: RenderNode, root: HTMLElement) {
  const causes: Cause.Cause<unknown>[] = [];
  const capturing = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ logLevel, cause }) => {
      if (logLevel === LogLevel.Error && Cause.isCause(cause) && !Cause.isEmpty(cause)) {
        causes.push(cause);
      }
    }),
  );
  const handle = await Effect.runPromise(mount(app, root).pipe(Effect.provide(capturing)));
  return { handle, causes };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

class FooError extends Data.TaggedError("Foo")<{ msg: string }> {}
class BarError extends Data.TaggedError("Bar")<{ code: number }> {}

/**
 * A child whose inferred error union is `FooError | BarError`, regardless of
 * which one it fails with at runtime. `which` picks the runtime error; the
 * static type always carries both tags.
 *
 * This lets `catchTag` reference a tag the child *can* produce ("Foo") while the
 * child actually fails with the *other* tag ("Bar") — exercising the re-raise
 * path with a fully type-checked `catchTag` call, no `as any` needed. (A child
 * typed `Effect<never, BarError>` would reject `catchTag({ tag: "Foo" })` at
 * compile time, since "Foo" is not in its error union.)
 */
function failWith(which: "Foo" | "Bar"): Effect.Effect<never, FooError | BarError> {
  return which === "Foo"
    ? Effect.fail(new FooError({ msg: "foo" }))
    : Effect.fail(new BarError({ code: 42 }));
}

/**
 * A boundary child that fails *synchronously* during construction — while
 * `renderNode` walks the subtree — rather than asynchronously post-mount.
 *
 * The public node builders (`h.*`, `Component.*`, bare `Effect`s) are all
 * consumed through the async stream path, so any error they raise surfaces
 * *after* mount, via `BoundaryContext`. To exercise `renderBoundary`'s
 * synchronous construction-time catch (spec AC1 / AC10–12) we hand the renderer
 * the raw component descriptor it consumes internally: a function component that
 * throws. The throw becomes a `Cause.die` at construction time.
 *
 * The single cast bridges the internal `{ type, props }` descriptor to the
 * public `Child` union, which only admits Nodes/Streams/Effects/primitives — it
 * is intentionally reaching one level below the public surface to drive a code
 * path the public API cannot reach synchronously.
 */
function throwsAtConstruction(error: unknown): Child {
  const component = () => {
    throw error;
  };
  return { type: component, props: {} } as unknown as Child;
}

// ── AC1 / AC10–12: Construction-time error → handled synchronously ────────────
// A child that throws while the subtree is being constructed fails the boundary
// synchronously, before its comment markers ever reach the DOM. `catchAllCause`
// sees the defect and renders the fallback in the same tick (no post-mount swap).

describe("AC1: construction-time error handled synchronously", () => {
  it("renders fallback synchronously when a child throws at construction", async () => {
    createTestDOM();
    const root = createRoot();

    const handle = await runMount(
      Boundary.catchAllCause({ fallback: () => h.span({ class: "fallback" }, "error!") }, [
        throwsAtConstruction(new Error("boom")),
      ]),
      root,
    );

    // No waitFor: the fallback is in place by the time mount resolves.
    assert.ok(root.querySelector(".fallback"), "Fallback should be rendered synchronously");
    assert.equal(root.querySelector(".fallback")?.textContent, "error!");

    await Effect.runPromise(handle.unmount());
  });

  it("does not render the failed children when the boundary catches at construction", async () => {
    createTestDOM();
    const root = createRoot();

    const handle = await runMount(
      Boundary.catchAllCause({ fallback: () => h.span({ class: "fallback" }, "error!") }, [
        throwsAtConstruction(new Error("boom")),
      ]),
      root,
    );

    assert.equal(root.querySelector(".content"), null, "Content must not be rendered");

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC11: construction-time error, match returns null → propagates ────────────
// `catchAll` only catches typed failures, so a construction-time *defect*
// (Cause.die) makes its `match` return null. With no parent boundary the error
// re-raises out of `renderBoundary` and rejects the `mount` Effect.

describe("AC11: construction-time match returns null → mount fails", () => {
  it("rejects when no boundary handles a construction-time defect", async () => {
    createTestDOM();
    const root = createRoot();

    await assert.rejects(
      runMount(
        Boundary.catchAll({ fallback: () => h.span({}, "err") }, [
          throwsAtConstruction(new Error("unhandled")),
        ]),
        root,
      ),
    );
  });
});

// ── AC15: post-mount error, match returns null, no parent → surfaced ──────────
// After mount has resolved a post-mount failure cannot reject the mount Effect,
// so when the outermost boundary cannot handle it (match → null, no parent) the
// cause is surfaced as an unhandled boundary failure via Effect.logError rather
// than being silently swallowed.

describe("AC15: unhandled post-mount error is surfaced, not swallowed", () => {
  it("logs the cause when an async stream defect escapes the outermost boundary", async () => {
    createTestDOM();
    const root = createRoot();

    // A defect (die) → catchAll's match returns null. No parent boundary.
    const dyingStream = Stream.concat(
      Stream.make(h.div({ class: "content" }, "live")),
      Stream.die(new Error("async-defect")),
    );

    const { handle, causes } = await runMountCapturingErrors(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "fb") }, [dyingStream]),
      root,
    );

    await waitFor(80);

    assert.equal(causes.length, 1, "Exactly one unhandled boundary failure should be surfaced");
    assert.ok(
      Cause.pretty(causes[0]!).includes("async-defect"),
      "Logged cause should be the escaped defect",
    );
    assert.equal(
      root.querySelector(".fallback"),
      null,
      "No fallback renders for an unhandled defect",
    );

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC16: Comment markers present in DOM ──────────────────────────────────────

describe("AC16: boundary comment markers in DOM", () => {
  it("start and end boundary markers are present after mount", async () => {
    createTestDOM();
    const root = createRoot();

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({}, "err") }, [h.div({ class: "ok" }, "hello")]),
      root,
    );

    const comments = getBoundaryComments(root);
    assert.ok(
      comments.some((c) => c.data.includes("boundary-start")),
      "Start marker missing",
    );
    assert.ok(
      comments.some((c) => c.data.includes("boundary-end")),
      "End marker missing",
    );

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC2: Post-mount stream failure → DOM swap ─────────────────────────────────
// A bare Effect/Stream child is consumed asynchronously, so its failure is
// reported to BoundaryContext after mount and triggers a DOM swap to the fallback.

describe("AC2: post-mount stream failure → DOM swap to fallback", () => {
  it("swaps DOM to fallback when a stream inside the boundary fails", async () => {
    createTestDOM();
    const root = createRoot();

    const failingStream = Stream.concat(
      Stream.make(h.div({ class: "content" }, "live")),
      Stream.fail(new FooError({ msg: "stream boom" })),
    );

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "stream error") }, [
        failingStream,
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(root.querySelector(".fallback"), "Fallback should appear after stream failure");
    assert.equal(root.querySelector(".content"), null, "Failed content must be removed on swap");

    await Effect.runPromise(handle.unmount());
  });

  it("catches an async stream failure nested inside an element", async () => {
    createTestDOM();
    const root = createRoot();

    const failingStream = Stream.concat(
      Stream.make(h.span({ class: "live" }, "x")),
      Stream.fail(new FooError({ msg: "deep" })),
    );

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "caught") }, [
        h.div({ class: "wrapper" }, [failingStream]),
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(
      root.querySelector(".fallback"),
      "Fallback should appear for a deeply nested failure",
    );
    assert.equal(root.querySelector(".wrapper"), null, "The whole subtree should be swapped out");

    await Effect.runPromise(handle.unmount());
  });

  it("catches a post-mount typed failure and renders the fallback", async () => {
    createTestDOM();
    const root = createRoot();

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "error!") }, [
        Effect.fail(new FooError({ msg: "boom" })),
      ]),
      root,
    );

    await waitFor(50);

    assert.ok(root.querySelector(".fallback"), "Fallback should be rendered");
    assert.equal(root.querySelector(".fallback")?.textContent, "error!");

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC5: BoundaryContext provided; inner shadows outer ────────────────────────

describe("AC5: BoundaryContext provided; inner boundary shadows outer", () => {
  it("inner boundary catches without triggering outer", async () => {
    createTestDOM();
    const root = createRoot();

    let outerTriggered = false;

    const handle = await runMount(
      Boundary.catchAll(
        {
          fallback: () => {
            outerTriggered = true;
            return h.span({ class: "outer-fallback" }, "outer");
          },
        },
        [
          Boundary.catchAll({ fallback: () => h.span({ class: "inner-fallback" }, "inner") }, [
            Effect.fail(new FooError({ msg: "inner" })),
          ]),
        ],
      ),
      root,
    );

    await waitFor(50);

    assert.ok(root.querySelector(".inner-fallback"), "Inner fallback should be rendered");
    assert.equal(root.querySelector(".outer-fallback"), null, "Outer fallback must not render");
    assert.equal(outerTriggered, false, "Outer boundary must not be triggered");

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC6: catchTag re-raise — error propagates to parent ──────────────────────
// The child's error union is `FooError | BarError`, so `catchTag({ tag: "Foo" })`
// type-checks. At runtime it fails with BarError, which the inner boundary does
// not handle, so the cause re-raises to the outer boundary.

describe("AC6: catchTag re-raise propagates to parent", () => {
  it("inner boundary re-raises when tag does not match, outer catches", async () => {
    createTestDOM();
    const root = createRoot();

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "outer-fallback" }, "outer caught") }, [
        Boundary.catchTag(
          { tag: "Foo", fallback: () => h.span({ class: "inner-fallback" }, "inner") },
          [failWith("Bar")],
        ),
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(root.querySelector(".outer-fallback"), "Outer fallback should catch re-raised error");
    assert.equal(root.querySelector(".inner-fallback"), null, "Inner fallback must not render");

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC19: Markers remain after DOM swap ───────────────────────────────────────

describe("AC19: markers remain after swap", () => {
  it("boundary markers survive after post-mount stream failure swap", async () => {
    createTestDOM();
    const root = createRoot();

    // A deferred we can fail on demand to trigger the post-mount stream failure.
    const failSignal = await Effect.runPromise(Deferred.make<void, FooError>());
    const controlledStream = Stream.fromEffect(Deferred.await(failSignal));

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "err") }, [
        controlledStream,
      ]),
      root,
    );

    await Effect.runPromise(Deferred.fail(failSignal, new FooError({ msg: "go" })));
    await waitFor(80);

    const comments = getBoundaryComments(root);
    assert.ok(
      comments.some((c) => c.data.includes("boundary-start")),
      "Start marker should remain after swap",
    );
    assert.ok(
      comments.some((c) => c.data.includes("boundary-end")),
      "End marker should remain after swap",
    );

    await Effect.runPromise(handle.unmount());
  });
});

// ── catchSome / catchIf with non-matching predicate re-raise ──────────────────

describe("edge: catchSome non-matching re-raises to parent", () => {
  it("outer boundary catches when catchSome returns none", async () => {
    createTestDOM();
    const root = createRoot();

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "outer-fallback" }, "outer") }, [
        Boundary.catchSome({ fallback: () => Option.none() }, [
          Effect.fail(new FooError({ msg: "e" })),
        ]),
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(root.querySelector(".outer-fallback"), "Outer should catch re-raised error");

    await Effect.runPromise(handle.unmount());
  });
});

describe("edge: catchIf false re-raises to parent", () => {
  it("outer boundary catches when catchIf predicate returns false", async () => {
    createTestDOM();
    const root = createRoot();

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "outer-fallback" }, "outer") }, [
        Boundary.catchIf({ predicate: () => false, fallback: () => h.span({}, "inner") }, [
          Effect.fail(new FooError({ msg: "e" })),
        ]),
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(root.querySelector(".outer-fallback"), "Outer should catch re-raised error");

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC3: Event handler errors are NOT caught ──────────────────────────────────

describe("AC3: event handler errors are NOT caught by boundary", () => {
  it("boundary fallback does not render when event handler throws", async () => {
    createTestDOM();
    const root = createRoot();

    let fallbackRendered = false;

    const handle = await runMount(
      Boundary.catchAll(
        {
          fallback: () => {
            fallbackRendered = true;
            return h.span({ class: "fallback" }, "err");
          },
        },
        [
          h.button(
            {
              onclick: () => {
                throw new Error("handler error");
              },
            },
            "click me",
          ),
        ],
      ),
      root,
    );

    const btn = root.querySelector("button");
    assert.ok(btn, "Button should be rendered");

    // btn.click() triggers a click event in jsdom without needing the Event constructor.
    btn!.click();
    await waitFor(20);

    assert.equal(fallbackRendered, false, "Boundary fallback must not trigger for event errors");

    await Effect.runPromise(handle.unmount());
  });
});

// ── Nested: inner catches, outer not triggered ────────────────────────────────

describe("nested: inner catches, outer not triggered", () => {
  it("outer boundary is clean when inner boundary handles the error", async () => {
    createTestDOM();
    const root = createRoot();

    let outerCalled = false;

    const handle = await runMount(
      Boundary.catchAll(
        {
          fallback: () => {
            outerCalled = true;
            return h.span({}, "outer");
          },
        },
        [
          Boundary.catchAll({ fallback: () => h.span({ class: "inner-fb" }, "inner") }, [
            Effect.fail(new FooError({ msg: "inner" })),
          ]),
          h.span({ class: "sibling" }, "sibling"),
        ],
      ),
      root,
    );

    await waitFor(50);

    assert.ok(root.querySelector(".inner-fb"));
    assert.ok(root.querySelector(".sibling"), "Sibling outside inner boundary should render");
    assert.equal(outerCalled, false);

    await Effect.runPromise(handle.unmount());
  });
});

// ── Nested: inner re-raises, outer catches ────────────────────────────────────

describe("nested: inner re-raises, outer catches", () => {
  it("outer catches when inner boundary re-raises (wrong tag)", async () => {
    createTestDOM();
    const root = createRoot();

    const handle = await runMount(
      Boundary.catchAllCause({ fallback: () => h.span({ class: "outer-fb" }, "outer") }, [
        Boundary.catchTag({ tag: "Bar", fallback: () => h.span({ class: "inner-fb" }, "inner") }, [
          failWith("Foo"),
        ]),
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(root.querySelector(".outer-fb"), "Outer should catch re-raised FooError");
    assert.equal(root.querySelector(".inner-fb"), null, "Inner fallback should not render");

    await Effect.runPromise(handle.unmount());
  });
});
