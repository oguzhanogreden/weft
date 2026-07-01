/**
 * Website config: dev/prod SSR server task + client build.
 *
 * `build` here produces the browser bundle (hashed assets + `.vite/manifest.json`)
 * into `dist/client`; the server bundle is built separately by `vite.ssr.config.ts`.
 * The `dev` task runs the universal `server.ts` (Vite middleware mode) via `tsx`,
 * and `build`/`start` cover the production flow.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import tailwindcss from "@tailwindcss/vite";
import { weftDocs } from "./src/lib/docs-plugin";

const weftPacks = ["@weftui/core#pack", "@weftui/dom#pack", "@weftui/router#pack"];

// Repo `docs/` sits one level above `website/`; the markdown loader bakes it at build time.
const docsRoot = fileURLToPath(new URL("../docs", import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), weftDocs({ docsRoot })],
  build: {
    manifest: true,
    outDir: "dist/client",
    rollupOptions: {
      input: "src/entry-client.ts",
    },
  },
  run: {
    tasks: {
      dev: {
        command: "tsx server.ts",
        dependsOn: weftPacks,
      },
      "build:client": {
        command: "vp build",
        dependsOn: weftPacks,
      },
      "build:server": {
        command: "vp build --config vite.ssr.config.ts",
        dependsOn: weftPacks,
      },
      build: {
        command: "echo website built",
        dependsOn: ["build:client", "build:server"],
      },
      start: {
        command: "NODE_ENV=production node server.ts",
        dependsOn: ["build"],
      },
    },
  },
});
