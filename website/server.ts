/**
 * Universal SSR server for the Weft website — dev and prod in one file.
 *
 * Dev (`NODE_ENV !== "production"`): runs Vite in middleware mode, loads the
 * server entry through `ssrLoadModule` per request (so workspace deps resolve and
 * edits hot-reload), renders the matched route, and runs the HTML through
 * `vite.transformIndexHtml` to inject Vite's HMR client. The client entry `<script>`
 * points at the raw `/src/entry-client.ts` Vite serves. HTML responses are
 * transformed; everything else is forwarded verbatim.
 *
 * Prod (`NODE_ENV === "production"`): no Vite in process. Serves the hashed client
 * build from `dist/client` as static files, and for page requests imports the
 * pre-built server bundle from `dist/server`, passing the manifest-resolved client
 * entry path. The streaming response body is piped straight to the socket.
 *
 * Build prod with `vp run build` (client + server), then `NODE_ENV=production tsx server.ts`.
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
// `vite-plus` re-exports Vite's API; the lint rule
// `vite-plus/prefer-vite-plus-imports` forbids importing from "vite" directly.
import { createServer as createViteServer } from "vite-plus";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const isProd = process.env.NODE_ENV === "production";

/** Reads a Node request body stream into a UTF-8 string (JSON rpc round-trips losslessly). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Builds a Fetch `Request` from a Node `IncomingMessage`, preserving method, headers, and body. */
async function toWebRequest(req: IncomingMessage, url: string): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(new URL(url, `http://localhost:${PORT}`), {
    method,
    headers,
    body: hasBody ? await readBody(req) : undefined,
  });
}

/** Writes a Fetch `Response` to a Node `ServerResponse`, streaming the body. */
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body === null) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
}

if (isProd) {
  await startProd();
} else {
  await startDev();
}

/** Dev server: Vite middleware mode + per-request `ssrLoadModule`. */
async function startDev(): Promise<void> {
  const vite = await createViteServer({
    root: __dirname,
    appType: "custom",
    // Pin the HMR WebSocket to a dedicated port (override with HMR_PORT) so it
    // never collides with Vite's shared default (24678) when another Vite dev
    // server is already running elsewhere on the machine.
    server: { middlewareMode: true, hmr: { port: Number(process.env.HMR_PORT ?? PORT + 1) } },
  });

  const server = createHttpServer((req, res) => {
    vite.middlewares(req, res, async () => {
      try {
        const url = (req as { originalUrl?: string }).originalUrl ?? req.url ?? "/";
        const { makeHandler } = await vite.ssrLoadModule("/src/entry-server.ts");
        const handler = makeHandler("/src/entry-client.ts");
        const response: Response = await handler(await toWebRequest(req, url));

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("text/html")) {
          const rendered = await response.text();
          const html = await vite.transformIndexHtml(url, rendered);
          res.statusCode = response.status;
          res.setHeader("Content-Type", "text/html");
          res.end(html);
          return;
        }

        // Non-HTML (e.g. /_eui/rpc JSON): forward untouched.
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        res.statusCode = 500;
        res.end((error as Error).stack);
      }
    });
  });

  server.listen(PORT, () => console.log(`[dev] website running at http://localhost:${PORT}`));
}

/** Prod server: static `dist/client` + pre-built `dist/server` SSR bundle. */
async function startProd(): Promise<void> {
  const clientDir = join(__dirname, "dist/client");
  const manifest = JSON.parse(
    await readFile(join(clientDir, ".vite/manifest.json"), "utf8"),
  ) as Record<string, { file: string }>;
  const clientEntry = `/${manifest["src/entry-client.ts"]!.file}`;

  // The built server bundle exports the same `makeHandler` as the source entry.
  const { makeHandler } = (await import("./dist/server/entry-server.js")) as {
    makeHandler: (clientEntry: string) => (request: Request) => Promise<Response>;
  };
  const handler = makeHandler(clientEntry);

  const server = createHttpServer((req, res) => {
    void (async () => {
      try {
        const url = req.url ?? "/";
        // Hashed build assets are immutable — serve them directly from disk.
        if (url.startsWith("/assets/") || url === clientEntry) {
          const filePath = join(clientDir, url);
          res.statusCode = 200;
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          createReadStream(filePath).pipe(res);
          return;
        }
        await writeWebResponse(res, await handler(await toWebRequest(req, url)));
      } catch (error) {
        res.statusCode = 500;
        res.end((error as Error).stack);
      }
    })();
  });

  server.listen(PORT, () => console.log(`[prod] website running at http://localhost:${PORT}`));
}
