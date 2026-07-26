/**
 * Browser test for the grid-size axis (`src/specs.md`, AC-GRIDSIZE).
 *
 * Mounts the real `App` in Chromium with the mock transport, so it is hermetic.
 * Covers both halves of a size switch, which can break independently: the DOM
 * re-inits at the new dimensions, and the PTY is told via `session.resize`.
 *
 * Note the mock's output is `Stream.fromIterable`, so every new subscription
 * replays the scripted chunks. Content reappearing after a re-init therefore
 * proves nothing on its own, which is why the non-regression test below keys on
 * the resize log (a re-init calls `session.resize`; a re-render must not).
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { type AppOptions, App } from "./app";
import { GRID_SIZES, gridSizeLabel } from "./grid-size";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let app: WeftApp.WeftApp;
let originalUrl: string;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  // Clicking a preset rewrites the query string; keep the runner's URL intact.
  originalUrl = window.location.href;
});

afterEach(async () => {
  await Effect.runPromise(WeftApp.dispose(app));
  container.remove();
  window.history.replaceState(null, "", originalUrl);
});

const mountWith = async (chunks: readonly string[], options?: AppOptions) => {
  const mock = makeMockTransport(chunks);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, App(options), container));
  // Generous: building the default 7,680 cells overruns waitFor's 1s default in
  // headless Chromium, and the top preset is nearly twice that again.
  await vi.waitFor(() => expect(container.querySelector(".term")).not.toBeNull(), {
    timeout: 15_000,
  });
  return mock;
};

/** Rows currently rendered, and how many cell spans the first one holds. */
const gridShape = () => {
  const rows = container.querySelectorAll(".term-row");
  return { rows: rows.length, cols: rows[0]?.querySelectorAll("span").length ?? 0 };
};

const clickSize = async (label: string) => {
  const button = await vi.waitFor(() => {
    const el = container.querySelector<HTMLButtonElement>(`[data-size="${label}"]`);
    expect(el).not.toBeNull();
    return el!;
  });
  button.click();
};

/**
 * The cheapest preset. Every case that is not specifically about the opening
 * size starts here, so the suite is not paying for 7,680 cells to assert a
 * switch, and so these cases do not move when the app default does.
 */
const SMALL: AppOptions = { cols: 80, rows: 24 };

describe("grid size axis (AC-GRIDSIZE)", () => {
  it("renders a button for every preset", async () => {
    await mountWith(["ready\r\n"], SMALL);
    const labels = [...container.querySelectorAll("[data-size]")].map((el) =>
      el.getAttribute("data-size"),
    );
    expect(labels).toEqual(GRID_SIZES.map(gridSizeLabel));
  });

  it("opens at 160x48", async () => {
    await mountWith(["ready\r\n"]);
    await vi.waitFor(() => expect(gridShape()).toEqual({ rows: 48, cols: 160 }), { timeout: 5000 });
  });

  it("honours an initial size from AppOptions (the URL path main.ts uses)", async () => {
    await mountWith(["ready\r\n"], { cols: 100, rows: 30 });
    await vi.waitFor(() => expect(gridShape()).toEqual({ rows: 30, cols: 100 }));
  });

  it("re-inits the grid and tells the PTY when a preset is clicked", async () => {
    const mock = await mountWith(["ready\r\n"], SMALL);
    await vi.waitFor(() => expect(gridShape()).toEqual({ rows: 24, cols: 80 }));

    await clickSize("120x40");

    await vi.waitFor(() => expect(gridShape()).toEqual({ rows: 40, cols: 120 }), { timeout: 5000 });
    // The PTY half: a real shell reflows off this, so assert it independently.
    await vi.waitFor(() => expect(mock.resizes.at(-1)).toEqual({ cols: 120, rows: 40 }));
  });

  it("reaches the top preset, 14,400 cells", async () => {
    // The heaviest step, and the one the spec calls punishing. "Slow" and
    // "structurally broken" are different claims, so assert the structure holds
    // even where the frame rate will not.
    const mock = await mountWith(["ready\r\n"], SMALL);
    await clickSize("240x60");
    await vi.waitFor(() => expect(gridShape()).toEqual({ rows: 60, cols: 240 }), {
      timeout: 20_000,
    });
    expect(mock.resizes.at(-1)).toEqual({ cols: 240, rows: 60 });
  });

  it("mirrors the chosen size into the query string", async () => {
    // Deliberately not the default size, so this asserts a real switch.
    await mountWith(["ready\r\n"], SMALL);
    await clickSize("200x50");
    await vi.waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect([params.get("cols"), params.get("rows")]).toEqual(["200", "50"]);
    });
  });

  it("does not re-init the grid when only the strategy changes", async () => {
    // The AC-RENDER invariant the nesting exists to protect. A rebuild of the
    // size-keyed item would call session.resize again, so a stable resize log is
    // the signal that survives the mock's replay-on-resubscribe.
    const mock = await mountWith(["hi\r\n"], SMALL);
    await clickSize("120x40");
    await vi.waitFor(() => expect(gridShape()).toEqual({ rows: 40, cols: 120 }), { timeout: 5000 });
    const afterResize = mock.resizes.length;

    const low = container.querySelector<HTMLButtonElement>('[data-strategy="low"]')!;
    low.click();

    await vi.waitFor(() => {
      const rows = container.querySelectorAll(".term-row");
      expect(rows.length).toBe(40); // re-rendered at the same size...
      expect(rows[0]?.textContent).toContain("hi"); // ...keeping its content
    });
    expect(mock.resizes.length).toBe(afterResize); // ...and without re-initing
  });

  it("keeps the pixel-lock across a size switch", async () => {
    // The probe lives on the stable pane, outside the size-keyed region, so the
    // measured lock must survive a re-init rather than being remeasured to zero.
    await mountWith(["ready\r\n"], SMALL);
    const pane = container.querySelector<HTMLElement>(".terminal-pane")!;
    await vi.waitFor(() => expect(Number.parseFloat(pane.style.lineHeight)).toBeGreaterThan(0));
    const locked = pane.style.lineHeight;

    await clickSize("120x40");

    await vi.waitFor(() => expect(gridShape()).toEqual({ rows: 40, cols: 120 }), { timeout: 5000 });
    expect(pane.style.lineHeight).toBe(locked);
  });
});
