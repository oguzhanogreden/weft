/**
 * Dev SSR server for the ssr-hydration example.
 *
 * Runs Vite in middleware mode and, per request, renders `<App/>` to hydratable
 * HTML via `entry-server.ts`, splices it into `index.html`'s `<!--ssr-outlet-->`
 * placeholder, and serves it. The browser then hydrates the markup with
 * `entry-client.ts`.
 */

import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// `vite-plus` re-exports Vite's API; the lint rule
// `vite-plus/prefer-vite-plus-imports` forbids importing from "vite" directly.
import { createServer as createViteServer } from "vite-plus";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3100;

const vite = await createViteServer({
  root: __dirname,
  appType: "custom",
  server: { middlewareMode: true },
});

const server = createHttpServer((req, res) => {
  vite.middlewares(req, res, async () => {
    try {
      // Connect (Vite's middleware stack) sets `originalUrl`; the bare
      // node:http type doesn't know about it.
      const url = (req as { originalUrl?: string }).originalUrl ?? req.url ?? "/";

      const template = await vite.transformIndexHtml(
        url,
        await readFile(resolve(__dirname, "index.html"), "utf-8"),
      );

      const { render } = await vite.ssrLoadModule("/src/entry-server.ts");
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
  console.log(`ssr-hydration demo running at http://localhost:${PORT}`);
});
