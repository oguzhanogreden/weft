import type { ViteUserConfig } from "vite-plus/test/config";
import { playwright } from "vite-plus/test/browser-playwright";

/**
 * Vitest browser-mode configuration for opt-in perf benchmarks (`*.bench.ts`).
 *
 * Kept separate from `vitest.browser.config.ts`: a benchmark takes minutes and
 * produces a measurement, not a pass/fail signal, so it must never run as part
 * of the default `vp run test:browser` sweep. This config's `include` only
 * matches `*.bench.ts` (never `*.browser.test.ts`), and vice versa, so a file
 * is discovered by exactly one of the two.
 *
 * Run via `vp run bench` (see root `vite.config.ts`), or target one file
 * directly: `vp test --config vitest.bench.config.ts <path> --reporter=verbose`
 * (`--reporter=verbose` matters: the default reporter only surfaces
 * `console.log` output for a failing test).
 */
const config: ViteUserConfig = {
  // Pre-bundle effect as one optimized dep, matching vitest.browser.config.ts,
  // in case a future bench file pulls in enough modules to trip the same
  // Rolldown re-chunking issue documented there.
  optimizeDeps: {
    include: ["effect"],
  },
  test: {
    include: ["**/*.bench.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright() as any, // cast as any because of tsgo quirk
      instances: [{ browser: "chromium" }],
    },
  },
};

export default config;
