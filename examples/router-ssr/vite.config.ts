import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: "tsx server.ts",
        dependsOn: ["@weftui/core#pack", "@weftui/dom#pack", "@weftui/router#pack"],
      },
    },
  },
});
