import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      pack: {
        command: "vp pack",
      },
    },
  },
  pack: {
    entry: ["src/index.ts", "!src/**/*.test.{ts,tsx}"],
    outDir: "dist",
    dts: true,
    platform: "node",
    minify: true,
    deps: {
      neverBundle: ["effect", /^@effect-ui\//],
    },
  },
});
