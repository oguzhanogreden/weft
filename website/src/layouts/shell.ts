/**
 * Document shell factory.
 *
 * Builds `<html>/<head>/<body>` with the `#root` mount point and the client entry
 * `<script>`, splicing the app via `yield* Router.Outlet` (injected per request by
 * `RouterServer`). The `<title>` and meta description are derived per request from the
 * current route's doc frontmatter (read from the `Docs` service, injected via the
 * router's render-time `context` seam). The client entry `src` differs between dev and
 * prod — dev points at the raw `/src/entry-client.ts`, prod at the hashed build
 * artifact — so it is a parameter rather than hardcoded.
 */

import { Component, h } from "@weftui/core";
import { Router } from "@weftui/router";
import { Docs, type DocsService } from "../lib/docs-service";

/** Default landing meta for non-doc routes. */
const DEFAULT_META = {
  title: "Weft — Reactive UI, woven from Effect",
  description: "An Effect-native reactive DOM library: flash-free SSR, no virtual DOM, no JSX.",
} as const;

/** Strips the query string from a normalized request URL. */
function pathnameOf(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/** Per-route `<title>` and meta description, from the current doc's frontmatter. */
function metaFor(path: string, get: DocsService["get"]): { title: string; description?: string } {
  const parts = path.split("/").filter((p) => p.length > 0);
  const doc =
    parts[0] === "api" && parts[1] !== undefined
      ? get("api", parts[1])
      : parts[0] === "docs" && parts[1] !== undefined && parts[2] !== undefined
        ? get(parts[1], parts[2])
        : undefined;
  if (doc === undefined) return { ...DEFAULT_META };
  return { title: `${doc.frontmatter.title} · Weft`, description: doc.frontmatter.description };
}

/** Builds the document shell `component` thunk for a given client entry `src`. */
export const documentShell = (clientEntry: string) =>
  Component.gen(function* () {
    const docs = yield* Docs;
    const router = yield* Router;
    const match = yield* router.currentMatch.get;
    const meta = metaFor(pathnameOf(match.url), docs.get);
    const outlet = yield* Router.Outlet;
    return yield* h.html({ lang: "en" }, [
      h.head([
        h.meta({ charset: "utf-8" }),
        h.meta({ name: "viewport", content: "width=device-width, initial-scale=1" }),
        h.title(meta.title),
        ...(meta.description === undefined
          ? []
          : [h.meta({ name: "description", content: meta.description })]),
      ]),
      h.body([h.main({ id: "root" }, [outlet]), h.script({ type: "module", src: clientEntry })]),
    ]);
  });
