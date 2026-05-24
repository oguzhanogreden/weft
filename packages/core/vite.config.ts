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
    entry: [
      "src/index.ts",
      "src/jsx-runtime/index.ts",
      "src/types/index.ts",
      "src/suspense/index.ts",
    ],
    outDir: "dist",
    dts: true,
    platform: "neutral",
    minify: true,
    deps: {
      neverBundle: ["effect", /^@effect-ui\//],
    },
  },
});
