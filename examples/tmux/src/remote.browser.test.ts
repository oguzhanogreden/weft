/**
 * Browser test for the connection status dot (`src/specs.md`, AC-REMOTE).
 *
 * Exercises the app's reaction to `session.status`, not the real socket/retry
 * logic: `transport-ws.ts` has no CI coverage by design (no real backend in
 * browser CI), so the mock drives `status` directly here. The retry decision
 * itself (backoff curve, the 1008 rule, the give-up boundary) is covered as
 * pure logic in `transport-ws.test.ts`.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { type AppOptions, App } from "./app";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let app: WeftApp.WeftApp;
let originalUrl: string;

const SMALL: AppOptions = { cols: 80, rows: 24 };

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  // Pinning a preset rewrites the query string; keep the runner's URL intact.
  originalUrl = window.location.href;
});

afterEach(async () => {
  await Effect.runPromise(WeftApp.dispose(app));
  container.remove();
  window.history.replaceState(null, "", originalUrl);
});

const mountApp = async (chunks: readonly string[] = ["$ "]) => {
  const mock = makeMockTransport(chunks);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, App(SMALL), container));
  const dot = await vi.waitFor(() => {
    const el = container.querySelector<HTMLElement>(".status");
    expect(el).not.toBeNull();
    return el!;
  });
  return { mock, dot };
};

const sendKey = (key: string) =>
  container
    .querySelector<HTMLElement>(".terminal-pane")!
    .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

describe("connection status (AC-REMOTE)", () => {
  it("renders live once mounted, the mock's default", async () => {
    const { dot } = await mountApp();
    await vi.waitFor(() => {
      expect(dot.className).toContain("status-live");
      expect(dot.dataset.status).toBe("live");
      expect(dot.textContent).toBe("live");
    });
  });

  it("reflects a status change to connecting", async () => {
    const { mock, dot } = await mountApp();
    Effect.runSync(mock.setStatus("connecting"));
    await vi.waitFor(() => {
      expect(dot.className).toContain("status-connecting");
      expect(dot.dataset.status).toBe("connecting");
      expect(dot.textContent).toBe("connecting…");
    });
  });

  it("renders unauthorized distinctly from offline", async () => {
    const { mock, dot } = await mountApp();
    Effect.runSync(mock.setStatus("offline"));
    await vi.waitFor(() => expect(dot.dataset.status).toBe("offline"));

    Effect.runSync(mock.setStatus("unauthorized"));
    await vi.waitFor(() => {
      expect(dot.className).toContain("status-unauthorized");
      expect(dot.className).not.toContain("status-offline");
      expect(dot.dataset.status).toBe("unauthorized");
    });
  });

  it("drops a write while not live, and accepts one again once live", async () => {
    const { mock } = await mountApp();
    Effect.runSync(mock.setStatus("offline"));

    sendKey("a");
    // Give a wrongly-accepted write a chance to land before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mock.writes).toEqual([]);

    Effect.runSync(mock.setStatus("live"));
    sendKey("b");
    await vi.waitFor(() => expect(mock.writes).toEqual(["b"]));
  });

  it("survives a status change with no remount: the row element stays the same node", async () => {
    const { mock } = await mountApp(["hello"]);
    await vi.waitFor(() => expect(container.textContent).toContain("hello"));
    const row = container.querySelector(".term-row");
    expect(row).not.toBeNull();

    Effect.runSync(mock.setStatus("offline"));
    Effect.runSync(mock.setStatus("live"));

    // Reference equality, not text content: a size-keyed remount would still
    // eventually show "hello" again (the mock replays on re-subscribe), so
    // matching text alone would pass even if the grid had been torn down.
    await vi.waitFor(() => {
      expect(container.querySelector(".term-row")).toBe(row);
      expect(row!.isConnected).toBe(true);
    });
  });

  it("keeps the status dot visible when the control groups collapse", async () => {
    const { dot } = await mountApp();
    const groups = container.querySelector<HTMLElement>(".control-groups")!;
    expect(groups.contains(dot)).toBe(false);
    expect(container.querySelector(".controls")!.contains(dot)).toBe(true);
  });

  it("keeps a bookmarked token in the URL when a preset pin rewrites cols/rows", async () => {
    // pinSize/resumeAuto (app.ts) build the next URL from `new URL(location.href)`
    // and touch only cols/rows, so any other param, e.g. a bookmarked token,
    // should survive untouched. Asserted here rather than only claimed in
    // specs.md.
    const url = new URL(window.location.href);
    url.searchParams.set("token", "secret-token");
    window.history.replaceState(null, "", url);

    await mountApp();
    const button = await vi.waitFor(() => {
      const el = container.querySelector<HTMLButtonElement>('[data-size="200x50"]');
      expect(el).not.toBeNull();
      return el!;
    });
    button.click();

    await vi.waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("token")).toBe("secret-token");
      expect([params.get("cols"), params.get("rows")]).toEqual(["200", "50"]);
    });
  });
});
