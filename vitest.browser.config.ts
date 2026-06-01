import { playwright } from "vite-plus/test/browser-playwright";
import type { ViteUserConfig } from "vite-plus/test/config";

/**
 * Vitest browser-mode configuration for end-to-end / real-browser tests.
 *
 * Kept separate from the default `vp test` (node/jsdom) run: this config only
 * picks up `*.browser.test.{ts,tsx}` files and executes them inside a real
 * Chromium instance driven by Playwright. The Playwright provider ships with
 * Vite+ (`vite-plus/test/browser-playwright`); only the `playwright` package and
 * its browser binaries are installed separately (`playwright install chromium`).
 *
 * Run via `vp run test:browser` (see root `vite.config.ts`).
 *
 * The config is authored as a typed object (rather than wrapped in
 * `defineConfig`) so the type-aware linter resolves `browser.provider` cleanly;
 * Vite+ accepts a default-exported config object directly.
 */
const config: ViteUserConfig = {
  test: {
    include: ["**/*.browser.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
};

export default config;
