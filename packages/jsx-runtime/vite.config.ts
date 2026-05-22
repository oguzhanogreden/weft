import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
    outDir: "dist",
    dts: true,
    platform: "node",
    minify: true,
    external: ["effect", /^@effect-ui\//],
  },
});
