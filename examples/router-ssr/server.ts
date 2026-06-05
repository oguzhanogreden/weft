/**
 * Dev SSR server for the router-ssr example.
 *
 * Runs Vite in middleware mode and, per request, renders the matched route to a
 * full hydratable HTML document via `entry-server.ts`'s `@effect/platform`-style
 * web handler, then runs the result through `vite.transformIndexHtml` so Vite's
 * HMR client and module rewriting are injected. The browser hydrates the markup
 * with `entry-client.ts` and takes over navigation.
 */

import { createServer as createHttpServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// `vite-plus` re-exports Vite's API; the lint rule
// `vite-plus/prefer-vite-plus-imports` forbids importing from "vite" directly.
import { createServer as createViteServer } from "vite-plus";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3200;

const vite = await createViteServer({
  root: __dirname,
  appType: "custom",
  server: { middlewareMode: true },
});

const server = createHttpServer((req, res) => {
  vite.middlewares(req, res, async () => {
    try {
      const url = (req as { originalUrl?: string }).originalUrl ?? req.url ?? "/";

      // Load the server entry through Vite so workspace deps resolve in dev.
      const { handler } = await vite.ssrLoadModule("/src/entry-server.ts");
      const response: Response = await handler(
        new Request(new URL(url, `http://localhost:${PORT}`)),
      );

      const rendered = await response.text();
      const html = await vite.transformIndexHtml(url, rendered);

      res.statusCode = response.status;
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
  console.log(`router-ssr demo running at http://localhost:${PORT}`);
});
