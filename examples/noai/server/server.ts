/**
 * Dev server for the noai example.
 *
 * Runs Vite in middleware mode and serves three things:
 *
 * - `GET /` : the page, carrying both halves of the `noai` signal.
 * - `WS  /dialogue` : the streamed crawler/site exchange.
 * - everything else : Vite's own middleware (HMR, module rewriting).
 *
 * The crawler's fetch tool targets `GET /` on this same server, so the signal it
 * reads is the one this file emits. See `src/specs.md`, AC-FETCH.
 */

import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Fiber, Option, Stream } from "effect";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import type { DialogueFrame, TransportMode } from "../src/transport";
import { DIALOGUE_PATH } from "../src/transport-live";
import { hasCredential, runDialogue } from "./agents";
import { injectIntoHead, injectRobotsMeta, withNoaiHeader } from "./signal";

/** Port the dev server listens on. */
export const PORT: number = 3300;

/**
 * Meta tag naming which transport the client should use. Duplicated, not shared:
 * exporting a constant for it would widen this example's approved API surface.
 * The other half of the pair is in `src/main.ts`, which reads it.
 */
const DIALOGUE_MODE_META = "noai-dialogue-mode";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Origins allowed to open the dialogue socket: this server's own, either spelling. */
const ALLOWED_ORIGINS: ReadonlyArray<string> = [
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
];

/**
 * Whether an upgrade request may open the dialogue socket.
 *
 * A WebSocket handshake is not subject to CORS, so without this any page open in
 * the same browser can connect to this server on loopback and start a dialogue.
 * On a live run that means billed model calls driven by an unrelated tab, so the
 * check is a cost control, not a formality.
 *
 * A missing `Origin` is allowed: non-browser clients (`curl`, the example's own
 * tests) send none, and they are not the risk being addressed.
 *
 * Exported so a node test can pin it without booting a listener. Added at
 * `/review-step`; see `src/specs.md`, AC-SOCKET-ORIGIN.
 */
export const isAllowedOrigin = (origin: string | undefined): boolean =>
  origin === undefined || ALLOWED_ORIGINS.includes(origin);

/**
 * Render the page to a full HTML document: the `X-Robots-Tag` header on the
 * response, the `robots` meta tag in `<head>` (AC-SIGNAL-HEADER /
 * AC-SIGNAL-META), and the meta tag naming the transport the client should use.
 *
 * All three live here rather than one being applied by the caller. The caller
 * previously injected the transport tag itself, which is how it kept a literal
 * `replace("<head>", …)` after the same bug was fixed in `injectRobotsMeta`, and
 * why nothing tested the assembled document. Exported so the node test can
 * assert it without booting a listener.
 */
export const renderPage = (
  template: string,
  mode: TransportMode,
): Effect.Effect<{ readonly html: string; readonly headers: Headers }> =>
  Effect.sync(() => ({
    html: injectIntoHead(
      injectRobotsMeta(template),
      `<meta name="${DIALOGUE_MODE_META}" content="${mode}">`,
    ),
    headers: withNoaiHeader(new Headers({ "content-type": "text/html; charset=utf-8" })),
  }));

/**
 * Wire encoding. `Option` has no stable JSON form, so the snapshot's two
 * optional fields go out as `string | null`, which `decodeFrame` accepts
 * alongside an in-memory `Option`.
 */
const encodeFrame = (frame: DialogueFrame): string =>
  JSON.stringify(
    frame._tag === "SignalObserved"
      ? {
          _tag: frame._tag,
          signal: {
            status: frame.signal.status,
            xRobotsTag: Option.getOrNull(frame.signal.xRobotsTag),
            robotsMeta: Option.getOrNull(frame.signal.robotsMeta),
          },
        }
      : frame,
  );

const servePage = async (
  vite: ViteDevServer,
  mode: TransportMode,
  response: http.ServerResponse,
): Promise<void> => {
  const template = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const page = await Effect.runPromise(
    renderPage(await vite.transformIndexHtml("/", template), mode),
  );
  const headers: Record<string, string> = {};
  page.headers.forEach((value, name) => {
    headers[name] = value;
  });
  response.writeHead(200, headers);
  // Nothing is injected here: assembly belongs to `renderPage`, which is tested.
  response.end(page.html);
};

/** Stream one dialogue down one socket, stopping when the socket goes away. */
const serveDialogue = (socket: WsSocket, origin: string): void => {
  const fiber = Effect.runFork(
    Stream.runForEach(runDialogue({ origin }), (frame) =>
      Effect.sync(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(encodeFrame(frame));
        }
      }),
    ),
  );
  socket.on("close", () => {
    void Effect.runPromise(Fiber.interrupt(fiber));
  });
};

/** Start the server. Resolves once it is listening. */
export const main = (): Effect.Effect<void> =>
  Effect.promise(async () => {
    // The transport is chosen once, here, because only the server can see
    // whether a credential resolved (AC-SCRIPTED / AC-NO-KEY-IN-CLIENT).
    const mode: TransportMode = (await Effect.runPromise(hasCredential())) ? "live" : "scripted";
    const vite = await createViteServer({
      root: ROOT,
      appType: "custom",
      server: { middlewareMode: true },
    });

    const server = http.createServer((request, response) => {
      const url = request.url ?? "/";
      if (url === "/" || url.startsWith("/?")) {
        void servePage(vite, mode, response);
        return;
      }
      vite.middlewares(request, response);
    });

    const sockets = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      if (!(request.url ?? "").startsWith(DIALOGUE_PATH)) {
        socket.destroy();
        return;
      }
      if (!isAllowedOrigin(request.headers.origin)) {
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (accepted) => {
        serveDialogue(accepted, `http://127.0.0.1:${PORT}`);
      });
    });

    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", () => resolve()));
    console.log(`noai listening on http://127.0.0.1:${PORT} (${mode} dialogue)`);
  });
