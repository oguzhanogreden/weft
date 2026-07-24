/**
 * End-to-end browser test for the tmux example.
 *
 * Mounts the real `App` in Chromium with the mock transport (`PtyTransportMock`),
 * so it is hermetic (no `node-pty` backend). Covers the single-terminal milestone
 * (streamed output renders, keystrokes flow back) and the perf harness (FPS and
 * rows/sec meters, load-driven updates, strategy switching).
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
  const term = await vi.waitFor(() => {
    const el = container.querySelector<HTMLElement>(".term");
    expect(el).not.toBeNull();
    return el!;
  });
  return { term, writes: mock.writes };
};

const meterValue = (selector: string): number =>
  Number((container.querySelector(selector)?.textContent ?? "").replace(/\D/g, "") || "0");

describe("tmux example", () => {
  it("renders streamed PTY output into the reactive grid", async () => {
    const { term } = await mountWith(["hello world\r\n$ "]);
    await vi.waitFor(() => {
      const rows = term.querySelectorAll(".term-row");
      expect(rows[0]?.textContent).toContain("hello world");
      expect(rows[1]?.textContent).toContain("$");
    });
  });

  it("sends keystrokes to the PTY via session.write", async () => {
    const { term, writes } = await mountWith(["$ "]);
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(writes.join("")).toBe("ls\r"));
  });

  it("shows live FPS and rows/sec meters", async () => {
    await mountWith(["ready\r\n"]);
    await vi.waitFor(
      () => {
        expect(container.querySelector(".meter.fps")?.textContent).toMatch(/fps: \d+/);
        expect(container.querySelector(".meter.rows")?.textContent).toMatch(/rows\/s: \d+/);
      },
      { timeout: 3000 },
    );
  });

  it("drives grid updates when a load level is selected (rows/s > 0)", async () => {
    await mountWith(["\r\n"]);
    const highLoad = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-load="high"]');
      expect(button).not.toBeNull();
      return button!;
    });
    highLoad.click();
    await vi.waitFor(() => expect(meterValue(".meter.rows")).toBeGreaterThan(0), { timeout: 4000 });
  });

  it("switches render strategy without losing the grid", async () => {
    await mountWith(["hi\r\n"]);
    // `high` is the default now, so switching to `low` is the meaningful switch.
    const lowStrategy = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-strategy="low"]');
      expect(button).not.toBeNull();
      return button!;
    });
    lowStrategy.click();
    await vi.waitFor(() => {
      const rows = container.querySelectorAll(".term-row");
      expect(rows.length).toBe(24);
      expect(rows[0]?.textContent).toContain("hi");
    });
  });

  it("renders per-cell colour by default (the real-use view opens coloured)", async () => {
    // A reverse-video run is how a menu draws its selection band. With `high` the
    // default, it must render as a coloured cell without switching strategy first.
    await mountWith(["\x1b[7mSEL\x1b[0m plain\r\n"]);
    await vi.waitFor(
      () => {
        const firstRow = container.querySelector(".term-row");
        const spans = [...(firstRow?.querySelectorAll("span") ?? [])] as HTMLElement[];
        expect(spans.length).toBeGreaterThan(0); // per-cell spans prove `high` is the default
        // The reverse-video "SEL" cells carry a background (the band); plain cells do not.
        expect(spans.some((span) => span.style.backgroundColor !== "")).toBe(true);
      },
      { timeout: 3000 },
    );
  });
});
