import { effectUiPrune } from "@effect-ui/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Reference usage of the Boundary.server prune plugin. It is `apply: "build"`,
  // so on a production client build it strips server-only `load`/`provide` from
  // each `Boundary.server` call (letting the bundler tree-shake the server code),
  // and stays inert in this example's dev SSR flow.
  plugins: [effectUiPrune()],
  run: {
    tasks: {
      dev: {
        command: "tsx server.ts",
        dependsOn: ["@effect-ui/core#pack", "@effect-ui/dom#pack", "@effect-ui/vite#pack"],
      },
    },
  },
});
