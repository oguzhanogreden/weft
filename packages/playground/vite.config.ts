import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: "vp dev",
        dependsOn: ["@effect-ui/core#pack", "@effect-ui/dom#pack"],
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
