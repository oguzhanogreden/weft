import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { Data, Deferred, Effect, Option, Stream } from "effect";
import { Boundary, h } from "@effect-ui/core";
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

async function runMount(app: unknown, root: HTMLElement) {
  return Effect.runPromise(mount(app as never, root));
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

class FooError extends Data.TaggedError("Foo")<{ msg: string }> {}
class BarError extends Data.TaggedError("Bar")<{ code: number }> {}

// ── AC1: Construction-time error → fallback rendered ─────────────────────────
// Note: in this renderer, child Effect failures become async stream errors.
// The boundary catches them via BoundaryContext and swaps the DOM asynchronously.

describe("AC1: construction-time error → fallback rendered", () => {
  it("renders fallback when child fails at construction time", async () => {
    createTestDOM();
    const root = createRoot();

    const failingChild = Effect.fail(new FooError({ msg: "boom" })) as unknown as ReturnType<
      typeof h.div
    >;

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "error!") }, [
        failingChild,
      ]),
      root,
    );

    await waitFor(50);

    assert.ok(root.querySelector(".fallback"), "Fallback should be rendered");
    assert.equal(root.querySelector(".fallback")?.textContent, "error!");

    await Effect.runPromise(handle.unmount());
  });

  it("does not render children when boundary catches construction error", async () => {
    createTestDOM();
    const root = createRoot();

    const failingChild = Effect.fail(new FooError({ msg: "boom" })) as unknown as ReturnType<
      typeof h.div
    >;

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "error!") }, [
        failingChild,
      ]),
      root,
    );

    await waitFor(50);

    assert.equal(root.querySelector(".content"), null, "Content must not be rendered");

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

describe("AC2: post-mount stream failure → DOM swap to fallback", () => {
  it("swaps DOM to fallback when stream inside boundary fails", async () => {
    createTestDOM();
    const root = createRoot();

    const failingStream = Stream.concat(
      Stream.make(h.div({ class: "content" }, "live") as unknown as never),
      Stream.fail(new FooError({ msg: "stream boom" })),
    );

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "stream error") }, [
        failingStream as unknown as ReturnType<typeof h.div>,
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(root.querySelector(".fallback"), "Fallback should appear after stream failure");

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC5: BoundaryContext provided; inner shadows outer ────────────────────────

describe("AC5: BoundaryContext provided; inner boundary shadows outer", () => {
  it("inner boundary catches without triggering outer", async () => {
    createTestDOM();
    const root = createRoot();

    const failingChild = Effect.fail(new FooError({ msg: "inner" })) as unknown as ReturnType<
      typeof h.div
    >;

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
            failingChild,
          ]) as unknown as ReturnType<typeof h.div>,
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

describe("AC6: catchTag re-raise propagates to parent", () => {
  it("inner boundary re-raises when tag does not match, outer catches", async () => {
    createTestDOM();
    const root = createRoot();

    // Child has BarError; inner boundary looks for "Foo" — mismatch, re-raises to outer.
    const failingChild = Effect.fail(new BarError({ code: 42 })) as unknown as ReturnType<
      typeof h.div
    >;

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "outer-fallback" }, "outer caught") }, [
        // oxlint-disable-next-line typescript/no-explicit-any
        (Boundary.catchTag as any)(
          { tag: "Foo", fallback: () => h.span({ class: "inner-fallback" }, "inner") },
          [failingChild],
        ) as ReturnType<typeof h.div>,
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(root.querySelector(".outer-fallback"), "Outer fallback should catch re-raised error");
    assert.equal(root.querySelector(".inner-fallback"), null, "Inner fallback must not render");

    await Effect.runPromise(handle.unmount());
  });
});

// ── AC11: match returns null → error propagates out of renderBoundary ─────────
// For this to propagate synchronously, we use a component that throws at render time
// (caught as a defect by Effect.gen). catchAll's match returns null for defects.

describe("AC11: match returns null → error propagates", () => {
  it("mount fails when boundary match returns null for synchronous failure (no parent boundary)", async () => {
    createTestDOM();
    const root = createRoot();

    // Component that throws synchronously → becomes Cause.die → catchAll returns null
    const ThrowingChild = {
      type: (): RenderNode => {
        throw new Error("unhandled");
      },
      props: {},
    };

    await assert.rejects(
      runMount(
        Boundary.catchAll({ fallback: () => h.span({}, "err") }, [
          ThrowingChild as unknown as ReturnType<typeof h.div>,
        ]),
        root,
      ),
    );
  });
});

// ── AC19: Markers remain after DOM swap ───────────────────────────────────────

describe("AC19: markers remain after swap", () => {
  it("boundary markers survive after post-mount stream failure swap", async () => {
    createTestDOM();
    const root = createRoot();

    // A deferred that we can fail to trigger the stream failure
    const failSignal = await Effect.runPromise(Deferred.make<void, FooError>());
    const controlledStream = Stream.fromEffect(Deferred.await(failSignal));

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "fallback" }, "err") }, [
        controlledStream as unknown as ReturnType<typeof h.div>,
      ]),
      root,
    );

    // Trigger failure
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

    const failingChild = Effect.fail(new FooError({ msg: "e" })) as unknown as ReturnType<
      typeof h.div
    >;

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "outer-fallback" }, "outer") }, [
        Boundary.catchSome({ fallback: () => Option.none() as unknown as never }, [
          failingChild,
        ]) as unknown as ReturnType<typeof h.div>,
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

    const failingChild = Effect.fail(new FooError({ msg: "e" })) as unknown as ReturnType<
      typeof h.div
    >;

    const handle = await runMount(
      Boundary.catchAll({ fallback: () => h.span({ class: "outer-fallback" }, "outer") }, [
        Boundary.catchIf({ predicate: () => false, fallback: () => h.span({}, "inner") }, [
          failingChild,
        ]) as unknown as ReturnType<typeof h.div>,
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

    // Use btn.click() — triggers click event in jsdom without needing Event constructor
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

    const failingChild = Effect.fail(new FooError({ msg: "inner" })) as unknown as ReturnType<
      typeof h.div
    >;

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
            failingChild,
          ]) as unknown as ReturnType<typeof h.div>,
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

    const failingChild = Effect.fail(new FooError({ msg: "foo" })) as unknown as ReturnType<
      typeof h.div
    >;

    const handle = await runMount(
      Boundary.catchAllCause({ fallback: () => h.span({ class: "outer-fb" }, "outer") }, [
        // oxlint-disable-next-line typescript/no-explicit-any
        (Boundary.catchTag as any)(
          { tag: "Bar", fallback: () => h.span({ class: "inner-fb" }, "inner") },
          [failingChild],
        ) as ReturnType<typeof h.div>,
      ]),
      root,
    );

    await waitFor(80);

    assert.ok(root.querySelector(".outer-fb"), "Outer should catch re-raised FooError");
    assert.equal(root.querySelector(".inner-fb"), null, "Inner fallback should not render");

    await Effect.runPromise(handle.unmount());
  });
});
