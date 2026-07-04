/**
 * Bundles the canonical `/docs` tree into each published package so the full
 * documentation ships inside `node_modules` (readable on disk by humans and coding
 * agents where the package is installed).
 *
 * The repo `/docs` is the single source of truth; this script copies it verbatim into
 * `packages/<pkg>/docs/` at pack/release time, rewriting relative Markdown links to
 * absolute URLs so they still resolve from inside `node_modules`:
 *   - an in-docs `.md` link → its live site route (`https://weftui.dev/docs/<section>/<slug>`)
 *   - a link escaping the docs tree (`../examples/…`, `../packages/…`) → an absolute
 *     GitHub URL on `main` (`/blob/main/<path>` for files, `/tree/main/<path>` for dirs)
 *   - protocol / `#anchor` / root-absolute links are left untouched
 * Links inside fenced code blocks are never rewritten.
 *
 * The generated `docs/` dirs are git-ignored and listed in each package's `files`, so
 * they are regenerated on every pack and published, never committed. Mirrors the
 * website's link rewriting in `website/src/lib/markdown-loader.ts`.
 *
 * Run directly (`node scripts/bundle-package-docs.mjs`) or via the root `bundle-docs`
 * task; the release `prepareCmd` runs it before `vp run pack`.
 */

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import {
  basename as posixBasename,
  dirname as posixDirname,
  relative as posixRelative,
  resolve as posixResolve,
} from "node:path/posix";
import { fileURLToPath } from "node:url";

/** Canonical deployed site base — in-docs `.md` links point here. */
const SITE_BASE = "https://weftui.dev";
/** GitHub base for links that escape the docs tree (must match `markdown-loader.ts`). */
const GITHUB_REPO_BASE = "https://github.com/stefvw93/weft";
/** Published packages that receive the bundled docs (`@weftui/vite` is excluded). */
const TARGET_PACKAGES = ["core", "dom", "router"];

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const docsRoot = join(repoRoot, "docs");

/** Normalizes OS path separators to posix (so link resolution is platform-independent). */
function toPosix(path) {
  return path.replaceAll("\\", "/");
}

/**
 * Rewrites one Markdown link `href` for a doc at `fileDir` (posix, absolute).
 * Mirrors `rewriteHref` in `website/src/lib/markdown-loader.ts`, but in-docs `.md`
 * targets resolve to the absolute site URL rather than a root-relative route.
 */
function rewriteHref(href, fileDir) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) {
    return href;
  }
  const hashAt = href.indexOf("#");
  const pathPart = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  if (pathPart === "") return href;

  const targetAbs = posixResolve(fileDir, pathPart);
  const relToDocs = posixRelative(toPosix(docsRoot), targetAbs);

  // Escapes the docs tree → absolute GitHub link (blob for files, tree for dirs).
  if (relToDocs.startsWith("..")) {
    const relToRepo = posixRelative(toPosix(repoRoot), targetAbs);
    const kind = extname(pathPart) === "" ? "tree" : "blob";
    return `${GITHUB_REPO_BASE}/${kind}/main/${relToRepo}${hash}`;
  }

  // Inside docs: only `.md` maps to a site route; other relatives are left alone.
  if (!pathPart.endsWith(".md")) return href;
  const section = posixDirname(relToDocs);
  const slug = posixBasename(relToDocs, ".md");
  return `${SITE_BASE}/docs/${section}/${slug}${hash}`;
}

/** Matches inline `](href)` / `](href "title")` and reference-def `[label]: href` targets. */
const INLINE_LINK = /(\]\()([^)\s]+)(\s+"[^"]*")?(\))/g;
const REF_DEF = /^(\s*\[[^\]]+\]:\s+)(\S+)(.*)$/;

/** Rewrites every relative Markdown link in `source`, skipping fenced code blocks. */
function rewriteLinks(source, filePath) {
  const fileDir = posixDirname(toPosix(filePath));
  const lines = source.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      const fence = /^\s*(```|~~~)/.test(line);
      if (fence) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      let out = line.replace(
        INLINE_LINK,
        (_m, open, href, title, close) =>
          `${open}${rewriteHref(href, fileDir)}${title ?? ""}${close}`,
      );
      out = out.replace(
        REF_DEF,
        (_m, prefix, href, rest) => `${prefix}${rewriteHref(href, fileDir)}${rest}`,
      );
      return out;
    })
    .join("\n");
}

/** Copies `/docs` into one package, rewriting links in every `.md` and copying other assets verbatim. */
function bundleInto(pkg) {
  const outRoot = join(repoRoot, "packages", pkg, "docs");
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outRoot, { recursive: true });

  let count = 0;
  for (const rel of readdirSync(docsRoot, { recursive: true })) {
    const src = join(docsRoot, rel);
    const dest = join(outRoot, rel);
    if (extname(rel) !== ".md") {
      // Directories are created lazily by the file copies below; copy non-md assets verbatim.
      if (extname(rel) !== "") {
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest);
      }
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, rewriteLinks(readFileSync(src, "utf8"), src));
    count += 1;
  }
  console.log(`  bundled ${count} docs → packages/${pkg}/docs`);
}

for (const pkg of TARGET_PACKAGES) bundleInto(pkg);
console.log(
  `Bundled /docs into ${TARGET_PACKAGES.length} packages (${relative(repoRoot, docsRoot)} → packages/*/docs).`,
);
