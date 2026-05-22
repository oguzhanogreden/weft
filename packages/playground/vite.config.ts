import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: "vite",
        dependsOn: [
          "@effect-ui/core#pack",
          "@effect-ui/dom#pack",
          "@effect-ui/html-types#pack",
          "@effect-ui/jsx-runtime#pack",
        ],
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
