/**
 * Perf benchmark for the render-strategy / load / grid-size axes (`src/specs.md`,
 * AC-RENDER / AC-PERF; roadmap item 9 in `next-steps.md`). Deliberately named
 * `.bench.ts`, not `.test.ts`/`.browser.test.ts`: it has its own config
 * (`vitest.bench.config.ts`) so neither `vp run test` nor `vp run test:browser`
 * discovers it, and it never adds minutes to the regular suite. Not a
 * correctness gate: its assertions only guard against the harness itself
 * breaking; the useful output is the console table.
 *
 * Run via `vp run bench` (after `vp run pack`; `bench` already depends on
 * `pack`), or target this file directly:
 *   vp test --config vitest.bench.config.ts \
 *     examples/tmux/src/perf-sweep.bench.ts --reporter=verbose
 *
 * (`--reporter=verbose` matters: the default reporter only surfaces
 * `console.log` output for a failing test.)
 *
 * Two passes, each holding every axis but one fixed so a reading is
 * attributable to a single dimension:
 *   A. strategy x load, size pinned at the default 160x48.
 *   B. strategy x size, load pinned at "med".
 *
 * The mock transport contributes nothing measurable here (`output` is empty):
 * every reading comes from `makeLoadStream`'s synthetic repaints, the same
 * generator the control bar's own load buttons drive.
 *
 * Known artifact: a cell whose rows/s sits well below its row-neighbours'
 * plateau is a saturated pump (`makeLoadStream` has no backpressure from the
 * DOM), not a real strategy/size reading, e.g. 240x60 across all strategies
 * and 200x50/low in a run recorded 2026-07-27. Distrust any cell like that;
 * healthy cells cluster near their size's rows/s ceiling.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { type AppOptions, App } from "./app";
import { GRID_SIZES, gridSizeLabel } from "./grid-size";
import type { LoadLevel, Strategy } from "./perf";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let app: WeftApp.WeftApp;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (app) await Effect.runPromise(WeftApp.dispose(app));
  container.remove();
});

const mount = async (options: AppOptions): Promise<void> => {
  const mock = makeMockTransport([]);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, App(options), container));
  await vi.waitFor(() => expect(container.querySelector(".term")).not.toBeNull(), {
    timeout: 15_000,
  });
};

const click = async (selector: string): Promise<void> => {
  const button = await vi.waitFor(() => {
    const el = container.querySelector<HTMLButtonElement>(selector);
    expect(el).not.toBeNull();
    return el!;
  });
  button.click();
};

const meterValue = (selector: string): number => {
  const text = container.querySelector(selector)?.textContent ?? "";
  const match = /(\d+)\s*$/.exec(text);
  return match?.[1] !== undefined ? Number(match[1]) : 0;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Sample both meters every 500ms (their own tick) for `totalMs`, then return
 * the median of the second half. Discarding the first half drops the
 * transient right after a strategy/load/size change, including the
 * AC-GRIDSIZE double-subscription artifact on a size switch.
 */
const settleAndRead = async (totalMs: number): Promise<{ fps: number; rows: number }> => {
  const samples: Array<{ fps: number; rows: number }> = [];
  for (let waited = 0; waited < totalMs; waited += 500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    samples.push({ fps: meterValue(".meter.fps"), rows: meterValue(".meter.rows") });
  }
  const tail = samples.slice(Math.floor(samples.length / 2));
  return { fps: median(tail.map((s) => s.fps)), rows: median(tail.map((s) => s.rows)) };
};

const STRATEGIES: readonly Strategy[] = ["low", "med", "high"];
const LOADS: readonly LoadLevel[] = ["off", "low", "med", "high"];
const SETTLE_MS = 4_000;

const sweepA: string[] = [];
const sweepB: string[] = [];

describe("perf sweep (run by exact path; see file header)", () => {
  it("logs the render environment once", () => {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    let renderer = "unknown (no WebGL context)";
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = ext
        ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER));
    }
    console.log(`\n--- environment ---\nUA: ${navigator.userAgent}\nWebGL renderer: ${renderer}`);
  });

  it("sweep A: strategy x load @ 160x48 (default size)", async () => {
    await mount({ cols: 160, rows: 48 });
    for (const strategy of STRATEGIES) {
      await click(`[data-strategy="${strategy}"]`);
      for (const load of LOADS) {
        await click(`[data-load="${load}"]`);
        const { fps, rows } = await settleAndRead(SETTLE_MS);
        sweepA.push(`${strategy}\t${load}\t${fps}\t${rows}`);
      }
    }
    console.log("\n--- sweep A: strategy x load @ 160x48 ---");
    console.log("strategy\tload\tfps\trows/s");
    console.log(sweepA.join("\n"));
  }, 120_000);

  for (const size of GRID_SIZES) {
    it(`sweep B: strategy x size @ load=med (${gridSizeLabel(size)})`, async () => {
      await mount({ cols: size.cols, rows: size.rows });
      await click('[data-load="med"]');
      for (const strategy of STRATEGIES) {
        await click(`[data-strategy="${strategy}"]`);
        const { fps, rows } = await settleAndRead(SETTLE_MS);
        sweepB.push(`${gridSizeLabel(size)}\t${strategy}\t${fps}\t${rows}`);
      }
    }, 60_000);
  }

  it("prints sweep B's results table", () => {
    console.log("\n--- sweep B: strategy x size @ load=med ---");
    console.log("size\tstrategy\tfps\trows/s");
    console.log(sweepB.join("\n"));
  });
});
