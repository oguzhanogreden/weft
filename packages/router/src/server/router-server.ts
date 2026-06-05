import type { Node } from "@effect-ui/core";
import { renderToStringHydratable } from "@effect-ui/dom/server";
import { Effect, Stream, Subscribable } from "effect";
import type { RouterDef } from "../compile";
import { match, type RouteMatch } from "../matcher";
import type { ComponentSlot } from "../route-tree";
import { RouterApp } from "../outlet";
import { Router } from "../router-service";

/**
 * Server-side rendering for a {@link RouterDef}. Matches a request URL, builds a
 * fixed-match server `Router`, renders the universal `RouterApp` to hydratable
 * HTML, and reports an HTTP status (404 when no route matches or a page raises
 * `RouterNotFound`).
 */
export namespace RouterServer {
  /**
   * Shared server options. The document shell is a {@link ComponentSlot} that splices
   * the app via `yield* Router.Outlet` (the router provides it per request) —
   * typically `<html><head>…</head><body><div id="root">{app}</div><script …></body></html>`.
   * `render` provides both `Router.Outlet` (the app, per request) and `Router` (to read
   * params), so the document may use either. Mirrors the route/layout `component` slot,
   * so it accepts both a plain thunk and a `Component.make` / `Component.gen` component.
   * `<!DOCTYPE html>` is prepended at serialize time.
   */
  export interface Options {
    /** The document shell slot; reads the app to splice via `yield* Router.Outlet`. */
    readonly document: ComponentSlot;
  }

  /** The result of {@link render}. */
  export interface Rendered {
    readonly html: string;
    readonly status: number;
  }

  /** Builds the fixed per-request `Router` from an already-resolved match; `navigate` is a no-op on the server. */
  function serverRouter(matched: RouteMatch): Router["Type"] {
    return Router.of({
      currentMatch: Subscribable.make({
        get: Effect.succeed(matched),
        changes: Stream.make(matched),
      }),
      navigate: () => Effect.void,
    });
  }

  /**
   * Renders the route matched by `options.url` to a hydratable HTML document
   * (S1/S2). Returns `{ html, status }` with `<!DOCTYPE html>` prepended.
   */
  export function render(
    def: RouterDef,
    options: Options & { readonly url: string },
  ): Effect.Effect<Rendered, Error> {
    return Effect.gen(function* () {
      const matched = match(def.compiled, options.url);
      // `status` is captured by `onNotFound` so a page-raised RouterNotFound (caught
      // by the internal boundary) also reports 404 without altering the render tree.
      let status = matched._tag === "NotFound" ? 404 : 200;
      const router = serverRouter(matched);
      // The app is injected into the document shell via `Router.Outlet`, mirroring
      // how a layout receives its outlet; the shell reads it with `yield* Router.Outlet`.
      const app = RouterApp(def, { onNotFound: () => void (status = 404) }) as Node<never, never>;
      const document = Effect.provideService(options.document({}), Router.Outlet, app);
      const html = yield* renderToStringHydratable(document).pipe(
        Effect.provideService(Router, router),
      );
      return { html: `<!DOCTYPE html>\n${html}`, status };
    });
  }

  /**
   * Builds a Web `fetch`-style handler `(Request) => Promise<Response>` that
   * renders the matched route to `text/html`. Suitable for bridging into a dev
   * server (e.g. Vite) or any Web-platform server.
   */
  export function toWebHandler(
    def: RouterDef,
    options: Options,
  ): (request: Request) => Promise<Response> {
    return (request) => {
      const url = new URL(request.url);
      const path = `${url.pathname}${url.search}`;
      return Effect.runPromise(
        render(def, { ...options, url: path }).pipe(
          Effect.map(
            ({ html, status }) =>
              new Response(html, {
                status,
                headers: { "content-type": "text/html; charset=utf-8" },
              }),
          ),
          Effect.catchAll((error) =>
            Effect.succeed(
              new Response(`Internal Server Error\n${String(error)}`, { status: 500 }),
            ),
          ),
        ),
      );
    };
  }
}
