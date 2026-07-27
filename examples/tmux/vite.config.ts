import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    // A tailnet MagicDNS name (e.g. `laptop.tailXXXX.ts.net`) is not known in
    // advance, so the Host-header allowlist has to be open rather than listing
    // it. `tailscale serve` still only routes tailnet traffic here; this only
    // controls which Host headers Vite itself accepts (see `src/specs.md`,
    // AC-REMOTE).
    allowedHosts: true,
    proxy: {
      // Local dev takes the same `/pty` path a `tailscale serve` proxy uses in
      // production, so the URL the app derives (`deriveWsUrl` in
      // `src/transport-ws.ts`) never branches between the two. No rewrite: the
      // backend (`server/server.ts`) reads only the query string and ignores
      // the request path, so forwarding `/pty` through unchanged is fine.
      "/pty": {
        target: "ws://127.0.0.1:8787",
        ws: true,
      },
    },
  },
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
