import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Schedule,
  Stream,
  SubscriptionRef,
} from "effect";
import { h } from "@weftui/core";
import type { Renderable } from "@weftui/core/types";
import { JSDOM } from "jsdom";
import { UnsupportedNodeTypeError } from "~/data";
import { hydrate, mount } from "./render";
import { hydrateScoped, mountScoped } from "./mount-scoped";
import { renderToStringHydratable as _renderToStringHydratable } from "~/server";
import { NoRpc } from "../__tests__/rpc-stub";

// ============================================================================
// Test setup (jsdom, mirrors dom.test.ts / hydrate.test.ts scaffolding)
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

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for a forked stream emission/update to reach the DOM. */
const tick = (): Promise<void> => waitFor(150);
const tickE = Effect.promise(tick);

const renderToStringHydratable = (n: Renderable) =>
  Effect.provide(_renderToStringHydratable(n), NoRpc);

/** A hand-rolled scoped service whose acquire/release we can observe. */
class Probe extends Context.Service<Probe, { readonly value: number }>()(
  "test/mount-scoped/Probe",
) {}

// ============================================================================
// AC-S2: ambient scope close unmounts (subscriptions interrupted, DOM retained)
// ============================================================================

describe("AC-S2: ambient scope close unmounts", () => {
  it("stops patching after the scope closes but leaves DOM nodes in root", async () => {
    createTestDOM();
    const root = createRoot();
    const region = await Effect.runPromise(SubscriptionRef.make<Renderable>("first"));

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mountScoped(h.div({}, [region.changes]), root);
          yield* tickE;
          assert.equal(root.textContent, "first");
          yield* SubscriptionRef.set(region, "second");
          yield* tickE;
          assert.equal(root.textContent, "second");
        }),
      ),
    );

    // Scope closed → unmounted. Further sets must not patch, nodes remain.
    const afterClose = root.textContent;
    await Effect.runPromise(SubscriptionRef.set(region, "third"));
    await tick();
    assert.equal(root.textContent, afterClose, "no patch after scope close");
    assert.equal(root.textContent, "second");
    assert.ok(root.childNodes.length > 0, "DOM nodes are not removed from root");
  });
});

// ============================================================================
// AC-S3: scoped layer provided outside the region stays alive for app lifetime
// ============================================================================

describe("AC-S3: scoped layer outside the region stays alive", () => {
  it("service is usable mid-lifetime; released only after the region ends", async () => {
    createTestDOM();
    const root = createRoot();
    let acquired = false;
    let released = false;

    const ProbeLive = Layer.effect(
      Probe,
      Effect.acquireRelease(
        Effect.sync(() => {
          acquired = true;
          return { value: 42 };
        }),
        () => Effect.sync(() => void (released = true)),
      ),
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mountScoped(h.div({}, "ok"), root);
          const probe = yield* Probe;
          assert.equal(probe.value, 42);
          assert.equal(acquired, true);
          assert.equal(released, false, "layer alive during the app lifetime");
        }),
      ).pipe(Effect.provide(ProbeLive)),
    );

    assert.equal(released, true, "layer released after the region ends");
  });
});

// ============================================================================
// AC-S4: teardown ordering — unmount (inner) before the outer layer release
// ============================================================================

describe("AC-S4: teardown ordering", () => {
  it("runs the mount's teardown before the provided layer's release", async () => {
    createTestDOM();
    const root = createRoot();
    const events: string[] = [];

    const LayerLive = Layer.effect(
      Probe,
      Effect.acquireRelease(Effect.succeed({ value: 1 }), () =>
        Effect.sync(() => void events.push("layer-teardown")),
      ),
    );

    // Stream stays open (never) so `ensuring` fires on unmount, not completion.
    const app = h.div({}, [
      Stream.make("x").pipe(
        Stream.concat(Stream.never),
        Stream.ensuring(Effect.sync(() => void events.push("app-teardown"))),
      ),
    ]);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mountScoped(app, root);
          yield* tickE;
        }),
      ).pipe(Effect.provide(LayerLive)),
    );

    assert.deepEqual(events, ["app-teardown", "layer-teardown"]);
  });
});

// ============================================================================
// AC-S5: manual unmount then scope close is idempotent (teardown fires once)
// ============================================================================

describe("AC-S5: idempotent unmount", () => {
  it("manual unmount then scope close exits successfully, teardown runs once", async () => {
    createTestDOM();
    const root = createRoot();
    let teardownCount = 0;

    const app = h.div({}, [
      Stream.make("x").pipe(
        Stream.concat(Stream.never),
        Stream.ensuring(Effect.sync(() => void teardownCount++)),
      ),
    ]);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* mountScoped(app, root);
          yield* tickE;
          yield* handle.unmount();
          yield* tickE;
        }),
      ),
    );

    assert.ok(Exit.isSuccess(exit), "region exits successfully");
    assert.equal(teardownCount, 1, "teardown side-effect fires exactly once");
  });
});

// ============================================================================
// AC-S6: failing render registers no finalizer and leaks nothing
// ============================================================================

describe("AC-S6: failing render", () => {
  it("fails with the tagged error; sibling scope finalizer still runs once", async () => {
    createTestDOM();
    const root = createRoot();
    let probe = 0;

    // `{ type: <non-string/non-function> }` → UnsupportedNodeTypeError.
    const badApp = { type: 42, props: {} } as unknown as Renderable;

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Effect.sync(() => void probe++));
          yield* mountScoped(badApp, root);
        }),
      ),
    );

    assert.ok(Exit.isFailure(exit), "region fails");
    const err = Exit.isFailure(exit) ? Option.getOrNull(Cause.findErrorOption(exit.cause)) : null;
    assert.ok(err instanceof UnsupportedNodeTypeError, "fails with UnsupportedNodeTypeError");
    assert.equal(probe, 1, "scope still tears down cleanly (finalizer runs once)");
  });
});

// ============================================================================
// hydrateScoped parity — adopts server HTML; scope close interrupts subscription
// ============================================================================

describe("hydrateScoped parity", () => {
  it("hydrates in a scoped region and stops patching after scope close", async () => {
    createTestDOM();
    const root = createRoot();
    const region = await Effect.runPromise(SubscriptionRef.make<Renderable>("srv"));

    const app = h.div({}, [region.changes]);
    const html = await Effect.runPromise(renderToStringHydratable(app));
    root.innerHTML = html;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* hydrateScoped(app, root);
          yield* tickE;
          yield* SubscriptionRef.set(region, "live");
          yield* tickE;
          assert.equal(root.textContent, "live");
        }),
      ),
    );

    const afterClose = root.textContent;
    await Effect.runPromise(SubscriptionRef.set(region, "post"));
    await tick();
    assert.equal(root.textContent, afterClose, "no patch after scope close");
  });
});

// ============================================================================
// AC-S9 (hardening): plain mount/hydrate auto-unmount at ambient scope close
// ============================================================================

describe("AC-S9: hardening — plain mount/hydrate honor an ambient scope", () => {
  it("plain mount inside Effect.scoped auto-unmounts at scope close", async () => {
    createTestDOM();
    const root = createRoot();
    const region = await Effect.runPromise(SubscriptionRef.make<Renderable>("first"));

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mount(h.div({}, [region.changes]), root);
          yield* tickE;
          assert.equal(root.textContent, "first");
        }),
      ),
    );

    await Effect.runPromise(SubscriptionRef.set(region, "second"));
    await tick();
    assert.equal(root.textContent, "first", "auto-unmounted: no patch after scope close");
  });

  it("plain hydrate inside Effect.scoped auto-unmounts at scope close", async () => {
    createTestDOM();
    const root = createRoot();
    const region = await Effect.runPromise(SubscriptionRef.make<Renderable>("srv"));

    const app = h.div({}, [region.changes]);
    const html = await Effect.runPromise(renderToStringHydratable(app));
    root.innerHTML = html;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* hydrate(app, root);
          yield* tickE;
          yield* SubscriptionRef.set(region, "live");
          yield* tickE;
          assert.equal(root.textContent, "live");
        }),
      ),
    );

    await Effect.runPromise(SubscriptionRef.set(region, "post"));
    await tick();
    assert.equal(root.textContent, "live", "auto-unmounted: no patch after scope close");
  });
});

// ============================================================================
// AC-S8: no ambient scope — plain mount behavior unchanged (regression guard)
// ============================================================================

describe("AC-S8: no-scope regression — plain mount via bare runPromise", () => {
  it("keeps the subscription live; nothing is auto-torn-down", async () => {
    createTestDOM();
    const root = createRoot();
    const region = await Effect.runPromise(SubscriptionRef.make<Renderable>("first"));

    const handle = await Effect.runPromise(mount(h.div({}, [region.changes]), root));
    await tick();
    assert.equal(root.textContent, "first");

    await Effect.runPromise(SubscriptionRef.set(region, "second"));
    await tick();
    assert.equal(root.textContent, "second", "still live with no ambient scope");

    await Effect.runPromise(handle.unmount());
  });
});

// ============================================================================
// AC-S10: unmount owns handler-forked scoped work — even when mounted inside an
// ambient scoped region, scoped work forked from an event handler attaches to the
// mount's INTERNAL scope (not the caller's ambient scope), so `handle.unmount()`
// interrupts it. Regression for a leak where handler `forkScoped` fibers bound to
// the outer scope survived unmount.
// ============================================================================

describe("AC-S10: unmount owns handler-forked scoped work", () => {
  it("interrupts a handler-forked scoped fiber on manual unmount inside a region", async () => {
    createTestDOM();
    const root = createRoot();
    const ticks = await Effect.runPromise(Ref.make(0));

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const app = h.div([
            h.button(
              {
                type: "button",
                "data-testid": "go",
                // The handler forks a scoped fiber that ticks forever. It must
                // attach to the mount's internal scope, not the outer region.
                onclick: () =>
                  Effect.forkScoped(
                    Ref.update(ticks, (n) => n + 1).pipe(
                      Effect.repeat(Schedule.spaced("10 millis")),
                    ),
                  ),
              },
              "go",
            ),
          ]);

          const handle = yield* mount(app, root);
          yield* Effect.promise(() => waitFor(30));
          root.querySelector<HTMLElement>('[data-testid="go"]')?.click();
          yield* Effect.promise(() => waitFor(60));
          const before = yield* Ref.get(ticks);
          assert.ok(before > 0, "handler forked and ticked while mounted");

          // Manual unmount (does NOT close the outer region scope).
          yield* handle.unmount();
          yield* Effect.promise(() => waitFor(120));
          const after = yield* Ref.get(ticks);
          assert.equal(after, before, "handler-forked fiber interrupted by unmount");
        }),
      ),
    );
  });
});
