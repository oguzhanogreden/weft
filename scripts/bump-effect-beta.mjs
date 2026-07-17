/**
 * Bumps the workspace to the latest Effect 4 beta.
 *
 * Weft tracks Effect 4's beta line (published on npm as `effect` under the
 * `beta` dist-tag — there is no `effect-smol` package). The workspace catalog
 * pins one exact beta (the "tested floor"); the published packages accept
 * `>=<floor> <4.0.0` as their peer range. This script advances that floor:
 *
 *   1. reads the `beta` dist-tag from the npm registry,
 *   2. rewrites the exact pin in `pnpm-workspace.yaml`'s catalog,
 *   3. rewrites the peer-range floor in each published package's package.json,
 *   4. rewrites the `effect@4.0.0-beta.N` "tested against" token in the docs
 *      that state it (READMEs + tutorial install pages).
 *
 * Only `4.0.0-beta.N` versions are accepted — a stable `4.0.0` (or anything
 * else) on the `beta` tag is refused so the jump off the beta line stays a
 * human decision.
 *
 * Run `node scripts/bump-effect-beta.mjs` (add `--dry-run` to preview).
 * Exits 0 with no changes when already on the latest beta. When
 * `$GITHUB_OUTPUT` is set, writes `updated=<bool>` and `version=<new>` for the
 * effect-beta-bump workflow. After a real bump, run `vp install` to refresh
 * the lockfile, then `vp run check` / `vp run test`.
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const isDryRun = process.argv.includes("--dry-run");

/** Published packages whose peer-range floor tracks the tested beta. */
const PEER_PACKAGES = ["core", "dom", "router"];
/** Docs stating the "tested against `effect@4.0.0-beta.N`" version. */
const DOC_FILES = [
  "README.md",
  "packages/core/README.md",
  "packages/dom/README.md",
  "packages/router/README.md",
  "docs/tutorial/01-your-first-app.md",
];
const BETA_RE = /^4\.0\.0-beta\.(\d+)$/;

function writeGithubOutput(updated, version) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `updated=${updated}\nversion=${version}\n`);
  }
}

const workspacePath = resolve(root, "pnpm-workspace.yaml");
const workspaceYaml = readFileSync(workspacePath, "utf8");
const currentMatch = workspaceYaml.match(/^(\s*)effect: (\S+)$/m);
if (!currentMatch) throw new Error("no `effect:` entry found in pnpm-workspace.yaml catalog");
const current = currentMatch[2];
if (!BETA_RE.test(current)) {
  throw new Error(`catalog pins effect@${current}, not a 4.0.0-beta.N version — refusing to bump`);
}

const response = await fetch("https://registry.npmjs.org/-/package/effect/dist-tags");
if (!response.ok)
  throw new Error(`registry request failed: ${response.status} ${response.statusText}`);
const distTags = await response.json();
const latest = distTags.beta;
if (typeof latest !== "string" || !BETA_RE.test(latest)) {
  throw new Error(
    `npm \`beta\` dist-tag is \`${latest}\` — not a 4.0.0-beta.N version, refusing to bump`,
  );
}

const currentN = Number(current.match(BETA_RE)[1]);
const latestN = Number(latest.match(BETA_RE)[1]);
if (latestN <= currentN) {
  console.log(`already on the latest beta (effect@${current}); nothing to do`);
  writeGithubOutput(false, current);
  process.exit(0);
}

console.log(`bumping effect ${current} → ${latest}${isDryRun ? " (dry run)" : ""}`);

/** Applies `edit` to `path`, throwing if it changed nothing (a silent no-op means drift). */
function rewrite(path, edit) {
  const before = readFileSync(resolve(root, path), "utf8");
  const after = edit(before);
  if (after === before) throw new Error(`${path}: expected content to rewrite was not found`);
  if (!isDryRun) writeFileSync(resolve(root, path), after);
  console.log(`  ${path}`);
}

rewrite("pnpm-workspace.yaml", (s) => s.replace(/^(\s*effect): \S+$/m, `$1: ${latest}`));
for (const name of PEER_PACKAGES) {
  rewrite(`packages/${name}/package.json`, (s) =>
    s.replace(`"effect": ">=${current} <4.0.0"`, `"effect": ">=${latest} <4.0.0"`),
  );
}
for (const path of DOC_FILES) {
  rewrite(path, (s) => s.replaceAll(`effect@${current}`, `effect@${latest}`));
}

writeGithubOutput(!isDryRun, latest);
console.log(
  isDryRun
    ? "dry run — no files written"
    : "done — run `vp install`, then `vp run check` and `vp run test`",
);
