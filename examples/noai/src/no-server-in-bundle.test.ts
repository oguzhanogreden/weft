/**
 * AC-NO-KEY-IN-CLIENT, as a static invariant.
 *
 * The criterion is negative: no credential ever reaches the browser bundle. No
 * signature can express that and no mounted assertion can catch it, so it is
 * checked by walking the import graph from the client entry.
 *
 * The rule enforced is the directory boundary, not just the SDK package: nothing
 * reachable from `src/main.ts` may value-import anything under `server/`. That is
 * the invariant the layout rests on ("Server-only modules are never imported from
 * the client entry", `src/specs.md`), and the SDK is one instance of it.
 *
 * Only **value** imports count. Under `verbatimModuleSyntax` an `import type`
 * statement is erased entirely and puts nothing in the bundle, so a client module
 * may legitimately type-import a server type. `import { type A } from "..."` is
 * not the same thing: it still emits the module specifier, so it counts.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vite-plus/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = HERE;
const SERVER_DIR = path.resolve(HERE, "../server");
const ENTRY = path.join(SRC_DIR, "main.ts");

const FORBIDDEN_PACKAGES = ["@anthropic-ai/sdk"];

/** One value import found in a module. */
interface ValueImport {
  readonly from: string;
  readonly specifier: string;
}

/**
 * Value-import specifiers of one module.
 *
 * Deliberately textual rather than AST-based: this test must not depend on a
 * parser, and the shapes it has to recognize are the ones this codebase writes.
 */
const valueImportsOf = (file: string): ReadonlyArray<string> => {
  const source = fs.readFileSync(file, "utf8");
  const found: string[] = [];

  // `import ... from "x"` / `export ... from "x"`, skipping `import type` and
  // `export type`, which erase.
  for (const match of source.matchAll(
    /(?:^|\n)[ \t]*(?:import|export)[ \t]+(type[ \t]+)?[^;]*?from[ \t]*["']([^"']+)["']/g,
  )) {
    if (match[1] === undefined && match[2] !== undefined) {
      found.push(match[2]);
    }
  }

  // Side-effect imports: `import "x"`.
  for (const match of source.matchAll(/(?:^|\n)[ \t]*import[ \t]*["']([^"']+)["']/g)) {
    if (match[1] !== undefined) {
      found.push(match[1]);
    }
  }

  return found;
};

/** Resolve a relative specifier to a file on disk, or `undefined` if it is bare. */
const resolveLocal = (from: string, specifier: string): string | undefined => {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return base;
};

/** Every module reachable from `entry` through value imports, plus the bare specifiers seen. */
const walk = (entry: string): { files: ReadonlySet<string>; bare: ReadonlyArray<ValueImport> } => {
  const files = new Set<string>();
  const bare: ValueImport[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || files.has(file) || !fs.existsSync(file)) {
      continue;
    }
    files.add(file);
    for (const specifier of valueImportsOf(file)) {
      const local = resolveLocal(file, specifier);
      if (local === undefined) {
        bare.push({ from: file, specifier });
      } else if (!files.has(local)) {
        queue.push(local);
      }
    }
  }

  return { files, bare };
};

const relative = (file: string): string => path.relative(path.resolve(HERE, ".."), file);

describe("AC-NO-KEY-IN-CLIENT: the client entry cannot reach the server", () => {
  it("actually reaches the client modules, so the walk is not vacuous", () => {
    // Without this the whole invariant passes trivially while `main.ts` is a
    // stub: a graph of one file imports nothing forbidden.
    const { files } = walk(ENTRY);
    const reached = [...files].map(relative);
    assert.ok(reached.includes("src/app.ts"), `app.ts not reached; walked ${reached.join(", ")}`);
    assert.ok(
      reached.includes("src/transport-live.ts"),
      `transport-live.ts not reached; walked ${reached.join(", ")}`,
    );
  });

  it("value-imports no module under server/", () => {
    const { files } = walk(ENTRY);
    const leaked = [...files].filter((file) => file.startsWith(`${SERVER_DIR}${path.sep}`));
    assert.deepEqual(leaked.map(relative), []);
  });

  it("value-imports no credential-bearing package", () => {
    const { bare } = walk(ENTRY);
    const leaked = bare.filter((entry) => FORBIDDEN_PACKAGES.includes(entry.specifier));
    assert.deepEqual(
      leaked.map((entry) => `${relative(entry.from)} -> ${entry.specifier}`),
      [],
    );
  });

  it("the SDK is used server side, so the invariant above is not green by absence", () => {
    // If nothing imported the SDK anywhere, every assertion above would pass
    // while proving nothing about where the credential lives.
    const serverFiles = fs
      .readdirSync(SERVER_DIR)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => path.join(SERVER_DIR, name));
    const importers = serverFiles.filter((file) =>
      valueImportsOf(file).some((specifier) => FORBIDDEN_PACKAGES.includes(specifier)),
    );
    assert.ok(importers.length > 0, "no server module imports the Anthropic SDK");
  });
});
