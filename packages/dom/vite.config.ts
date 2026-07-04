import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      pack: {
        command: "vp pack",
        output: ["dist/**"],
      },
    },
  },
  pack: {
    entry: ["src/index.ts", "src/client/index.ts", "src/server/index.ts"],
    outDir: "dist",
    dts: true,
    platform: "neutral",
    minify: true,
    deps: {
      neverBundle: ["effect", /^@weftui\//],
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  // Browser e2e tests (`*.browser.test.*`) are excluded from the default
  // node/jsdom `vp test` run and executed via the root `vitest.browser.config.ts`
  // instead (same convention as the website package).
  test: {
    exclude: ["**/*.browser.test.{ts,tsx}"],
  },
});
