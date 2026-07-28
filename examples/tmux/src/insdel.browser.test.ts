/**
 * Browser test for insert/delete line and character (AC-INSDEL).
 *
 * Drives the whole pipeline (mock PTY bytes -> parser -> grid -> reactive DOM)
 * with a synthetic vim-flavoured sequence: open a line with IL inside a scroll
 * region, type into it, close another with DL, then splice a word with ICH and
 * DCH. The status row pinned below the region must never move (the same
 * region-gating that keeps a real tmux status bar in place). No PTY capture
 * contains these sequences, so input is synthetic per the AC-CHARSET precedent.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let app: WeftApp.WeftApp | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (app) await Effect.runPromise(WeftApp.dispose(app));
  app = undefined;
  container.remove();
});

const mountWith = async (chunks: readonly string[]) => {
  const mock = makeMockTransport(chunks);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, App({ cols: 80, rows: 24 }), container));
  await vi.waitFor(() => {
    expect(container.querySelectorAll(".term-row").length).toBe(24);
  });
};

describe("insert/delete line and character (AC-INSDEL)", () => {
  it("IL opens a line inside the region, DL closes one, ICH/DCH splice a word; the status row never moves", async () => {
    const seq =
      "\x1b[1;23r" + // scroll region rows 1-23 (0-22), homes the cursor
      "alpha\r\nbeta\r\ngamma" +
      "\x1b[24;1Hstatus" + // pinned below the region
      "\x1b[2;1H\x1b[L" + // IL: open a blank line above "beta"
      "new line" + // typed into the opened line
      "\x1b[3;1H\x1b[M" + // DL: delete "beta"
      "\x1b[2;5H\x1b[5@born " + // ICH: make room, type "born "
      "\x1b[2;1H\x1b[4P"; // DCH: strip the leading "new "
    await mountWith([seq]);

    await vi.waitFor(() => {
      const rows = [...container.querySelectorAll(".term-row")].map((r) => r.textContent ?? "");
      expect(rows[0]).toContain("alpha");
      expect(rows[1]).toContain("born line");
      expect(rows[1]).not.toContain("new");
      expect(rows[2]).toContain("gamma");
      expect(rows.join("")).not.toContain("beta"); // DL removed it everywhere
      expect(rows[23]).toContain("status"); // outside the region: untouched
    });
  });
});
