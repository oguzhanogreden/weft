/**
 * Vite plugin that bakes `docs/**\/*.md` into the `virtual:weft-docs` module, and the
 * hand-authored landing-page hero snippet into `virtual:weft-home-snippet`.
 *
 * On `load` it globs the docs tree, runs each file through `parseDoc`, and emits a
 * pure-data module exporting `getAllDocs()` / `getDoc(category, slug)`. The doc model
 * is therefore resolved once at build time and imported as plain data by both the
 * server and client bundles — no markdown/highlighter code reaches the browser. The
 * home snippet is highlighted by the same pipeline and exported as a `tree` the
 * landing page renders via `renderHast`. In dev it watches the docs tree and triggers
 * a reload when a `.md` file changes.
 */

import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Plugin } from "vite-plus";
import { type DocModel, parseDoc } from "./markdown-loader";

const VIRTUAL_ID = "virtual:weft-docs";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const SNIPPET_ID = "virtual:weft-home-snippet";
const SNIPPET_RESOLVED_ID = `\0${SNIPPET_ID}`;
/** Sentinel for `Infinity` (not JSON-representable) — replaced with a JS literal in the emitted module. */
const INFINITY_TOKEN = "__WEFT_INFINITY__";

/** The landing-page code teaser, highlighted at build time through the doc pipeline. */
const HOME_SNIPPET = `---
title: home-snippet
---

\`\`\`ts
import { Component, h } from "@weftui/core";
import { Stream, SubscriptionRef } from "effect";

// A counter: a SubscriptionRef signal whose .changes stream
// drives the text node directly — no virtual DOM, no diffing.
const Counter = Component.gen(function* () {
  const count = yield* SubscriptionRef.make(0);
  return yield* h.button(
    { onclick: () => SubscriptionRef.update(count, (n) => n + 1) },
    [Stream.map(count.changes, String)],
  );
});
\`\`\`
`;

/** Highlights the home snippet and emits a module exporting its serialized hast `tree`. */
async function snippetModuleSource(docsRoot: string): Promise<string> {
  const doc = await parseDoc(HOME_SNIPPET, `${docsRoot}/__home-snippet.md`, docsRoot);
  return `export const tree = ${JSON.stringify(doc.tree)};\n`;
}

/** Normalizes an OS path to posix separators (so link resolution is platform-independent). */
function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Reads every `docs/**\/*.md` (excluding `index.md`) into a deduped `DocModel[]`. */
async function loadAllDocs(docsRoot: string): Promise<DocModel[]> {
  const entries = await readdir(docsRoot, { recursive: true });
  const docs: DocModel[] = [];
  const seen = new Set<string>();
  for (const rel of entries) {
    if (!rel.endsWith(".md") || basename(rel) === "index.md") continue;
    const filePath = join(docsRoot, rel);
    const source = await readFile(filePath, "utf8");
    const doc = await parseDoc(source, toPosix(filePath), toPosix(docsRoot));
    const key = `${doc.category}/${doc.slug}`;
    if (seen.has(key)) throw new Error(`Duplicate doc route (category, slug): "${key}"`);
    seen.add(key);
    docs.push(doc);
  }
  return docs;
}

/** Emits the `virtual:weft-docs` module source for a resolved doc set. */
function toModuleSource(docs: readonly DocModel[]): string {
  const json = JSON.stringify(docs, (_key, value) => (value === Infinity ? INFINITY_TOKEN : value));
  const literal = json.replaceAll(`"${INFINITY_TOKEN}"`, "Infinity");
  return [
    `const docs = ${literal};`,
    `const byKey = new Map(docs.map((d) => [d.category + "/" + d.slug, d]));`,
    `export const getAllDocs = () => docs;`,
    `export const getDoc = (category, slug) => byKey.get(category + "/" + slug);`,
    "",
  ].join("\n");
}

/** Builds the `virtual:weft-docs` plugin for a given absolute `docsRoot`. */
export function weftDocs(options: { readonly docsRoot: string }): Plugin {
  const docsRoot = toPosix(options.docsRoot);
  return {
    name: "weft-docs",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      if (id === SNIPPET_ID) return SNIPPET_RESOLVED_ID;
      return undefined;
    },
    async load(id) {
      if (id === RESOLVED_ID) return toModuleSource(await loadAllDocs(docsRoot));
      if (id === SNIPPET_ID || id === SNIPPET_RESOLVED_ID) return snippetModuleSource(docsRoot);
      return undefined;
    },
    configureServer(server) {
      const reload = (file: string): void => {
        if (!toPosix(file).startsWith(docsRoot) || !file.endsWith(".md")) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.add(docsRoot);
      server.watcher.on("change", reload);
      server.watcher.on("add", reload);
      server.watcher.on("unlink", reload);
    },
  };
}
