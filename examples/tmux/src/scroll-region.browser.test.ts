/**
 * Browser test for scroll regions (AC-SCROLLREGION).
 *
 * Drives the whole pipeline end to end (mock PTY bytes -> parser -> grid ->
 * reactive DOM) with the exact shape that broke `tmux attach`: a status line
 * pinned on the bottom row, a scroll region that excludes it, then enough output
 * to overflow and scroll the region. The pinned row must survive (no bleed).
 *
 * Hermetic: mock transport, no backend. The assertions are on row text, not
 * layout, so the example's `index.html` CSS is not needed.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let app: WeftApp.WeftApp;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await Effect.runPromise(WeftApp.dispose(app));
  container.remove();
});

const mountWith = async (chunks: readonly string[]) => {
  const mock = makeMockTransport(chunks);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, App(), container));
  await vi.waitFor(() => {
    expect(container.querySelectorAll(".term-row").length).toBe(24);
  });
};

describe("scroll region (AC-SCROLLREGION)", () => {
  it("keeps the pinned status row while the region scrolls (tmux-attach bleed)", async () => {
    const status = "\x1b[24;1HSTATUS-BAR"; // pin a status line on row 24 (outside the region)
    const region = "\x1b[1;23r"; // reserve rows 1..23 as the scroll region; homes the cursor
    let content = "";
    for (let i = 1; i <= 30; i += 1) content += `line${i}\r\n`; // overflow the 23-row region
    await mountWith([status + region + content]);

    await vi.waitFor(() => {
      const rows = [...container.querySelectorAll(".term-row")];
      // The pinned status row is not scrolled away by the region's scrolling.
      expect(rows[23]?.textContent).toContain("STATUS-BAR");
      // The region scrolled: the newest line is visible, the oldest has scrolled off.
      const regionRows = rows.slice(0, 23).map((r) => (r.textContent ?? "").trim());
      expect(regionRows).toContain("line30");
      expect(regionRows).not.toContain("line1");
    });
  });
});
