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
    entry: ["src/index.tsx"],
    outDir: "dist",
    dts: true,
    platform: "neutral",
    minify: true,
    deps: {
      neverBundle: ["effect", /^@effect-ui\//],
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
});
