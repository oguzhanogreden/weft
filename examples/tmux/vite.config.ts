import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: "vp dev",
        dependsOn: ["@weftui/core#pack", "@weftui/dom#pack"],
      },
    },
  },
  // The pure terminal core (grid/parser) carries fast node unit tests. Browser
  // tests are excluded here; they run via the repo's flat browser config.
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/*.browser.test.{ts,tsx}", "**/node_modules/**", "**/dist/**"],
  },
});
