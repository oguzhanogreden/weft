/**
 * Dev SSR server for the suspense example.
 *
 * Runs Vite in middleware mode, SSRs `<App/>` to streaming hydratable HTML
 * via `entry-server.tsx`, and splices it into `index.html`'s `<!--ssr-outlet-->`
 * placeholder. The browser then:
 *   1. Receives the initial HTML (fallbacks showing)
 *   2. Executes the inline `<script>` patches as each Suspense boundary resolves
 *   3. Hydrates with `entry-client.tsx`
 *
 * Because all patch scripts execute before `hydrate()` loads, the client sees
 * fully resolved content with stream markers in place — no flash.
 */

import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite-plus";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3101;

const vite = await createViteServer({
  root: __dirname,
  appType: "custom",
  server: { middlewareMode: true },
  esbuild: { jsx: "automatic", jsxImportSource: "@effect-ui/core" },
});

const server = createHttpServer((req, res) => {
  vite.middlewares(req, res, async () => {
    try {
      const url = (req as { originalUrl?: string }).originalUrl ?? req.url ?? "/";

      const template = await vite.transformIndexHtml(
        url,
        await readFile(resolve(__dirname, "index.html"), "utf-8"),
      );

      const { render } = await vite.ssrLoadModule("/src/entry-server.tsx");
      const appHtml: string = await render();

      const html = template.replace("<!--ssr-outlet-->", appHtml);

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      res.statusCode = 500;
      res.end((error as Error).stack);
    }
  });
});

server.listen(PORT, () => {
  console.log(`suspense demo running at http://localhost:${PORT}`);
});
