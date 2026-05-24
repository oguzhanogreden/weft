import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: "tsx server.ts",
        dependsOn: ["@effect-ui/core#pack", "@effect-ui/dom#pack"],
      },
    },
  },
});
