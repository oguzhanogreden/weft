/**
 * Vite plugin that bakes `docs/**\/*.md` into the `virtual:weft-docs` module.
 *
 * On `load` it globs the docs tree, runs each file through `parseDoc`, and emits a
 * pure-data module exporting `getAllDocs()` / `getDoc(category, slug)`. The doc model
 * is therefore resolved once at build time and imported as plain data by both the
 * server and client bundles — no markdown/highlighter code reaches the browser. In
 * dev it watches the docs tree and triggers a reload when a `.md` file changes.
 */

import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Plugin } from "vite-plus";
import { type DocModel, parseDoc } from "./markdown-loader";

const VIRTUAL_ID = "virtual:weft-docs";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
/** Sentinel for `Infinity` (not JSON-representable) — replaced with a JS literal in the emitted module. */
const INFINITY_TOKEN = "__WEFT_INFINITY__";

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
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined;
      return toModuleSource(await loadAllDocs(docsRoot));
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
