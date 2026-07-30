import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    proxy: {
      // Local dev takes the same `/dialogue` path the server serves in
      // production, so the URL the client derives (`deriveWsUrl` in
      // `src/transport-live.ts`) never branches between the two.
      "/dialogue": {
        target: "ws://127.0.0.1:3300",
        ws: true,
      },
    },
  },
  run: {
    tasks: {
      // One command, not two: `main()` hosts Vite in middleware mode, so the
      // page and the dialogue socket come from the same origin. That is what
      // lets the crawler's fetch tool target the server that runs it (AC-FETCH).
      dev: {
        command: "tsx server/main.ts",
        dependsOn: ["@weftui/core#pack", "@weftui/dom#pack"],
      },
    },
  },
  // Unlike `examples/tmux`, whose `server/` is a separate non-workspace package
  // tested via a bare `node --test`, this example's server is part of the
  // workspace. Its tests must therefore be included here, or `vp run test`
  // silently skips them (see `src/specs.md`, Test wiring).
  test: {
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    exclude: ["**/*.browser.test.{ts,tsx}", "**/node_modules/**", "**/dist/**"],
  },
});
