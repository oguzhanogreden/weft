import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite-plus";
import { afterAll, beforeAll, describe, it } from "vite-plus/test";
import { effectUiPrune } from "./index";

/**
 * AC-3 (tree-shake enablement): with `load`/`provide` removed on the client
 * build, a server-only identifier reachable only through them is absent from the
 * client bundle, yet present in the SSR bundle (where the plugin is a no-op).
 *
 * `@effect-ui/core` is aliased to a tiny stub so the test exercises the plugin's
 * import-binding match + real Rollup DCE without pulling in the whole library.
 */

const SENTINEL = "DATABASE_LIVE_SENTINEL_XYZ";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "effect-ui-prune-"));
  writeFileSync(
    join(dir, "core-stub.ts"),
    `export const Boundary = { server: (o, r) => ({ o, r }) };\n`,
  );
  writeFileSync(
    join(dir, "server-only.ts"),
    `export const DatabaseLive = { sentinel: "${SENTINEL}" };\n`,
  );
  writeFileSync(
    join(dir, "app.ts"),
    [
      `import { Boundary } from "@effect-ui/core";`,
      `import { DatabaseLive } from "./server-only";`,
      `export const App = () =>`,
      `  Boundary.server({ load: () => 1, provide: DatabaseLive, schema: { name: "p" } }, (d) => d);`,
      ``,
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Concatenate the JS of every emitted chunk from a programmatic build. */
async function bundle(ssr: boolean): Promise<string> {
  const entry = join(dir, "app.ts");
  const result = (await build({
    root: dir,
    logLevel: "silent",
    configFile: false,
    resolve: { alias: { "@effect-ui/core": join(dir, "core-stub.ts") } },
    plugins: [effectUiPrune()],
    build: {
      write: false,
      minify: false,
      ...(ssr ? { ssr: entry } : { lib: { entry, formats: ["es"] as const, fileName: "app" } }),
      rollupOptions: {
        ...(ssr ? { input: entry, output: { format: "es" as const } } : {}),
        treeshake: { moduleSideEffects: false },
      },
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- programmatic build result shape varies by mode
  })) as any;

  const outputs = Array.isArray(result) ? result : [result];
  return outputs
    .flatMap((o: { output: ReadonlyArray<{ type: string; code?: string }> }) => o.output)
    .filter((chunk) => chunk.type === "chunk")
    .map((chunk) => chunk.code ?? "")
    .join("\n");
}

describe("AC-3 — tree-shake enablement", () => {
  it("drops the server-only identifier from the client bundle but keeps it in SSR", async () => {
    const clientCode = await bundle(false);
    const ssrCode = await bundle(true);

    assert.ok(
      !clientCode.includes(SENTINEL),
      "server-only DatabaseLive must be tree-shaken from the client bundle",
    );
    assert.ok(!clientCode.includes("provide"), "provide key must be stripped on the client");

    assert.ok(
      ssrCode.includes(SENTINEL),
      "DatabaseLive must remain in the SSR bundle (plugin is a no-op there)",
    );
  }, 60000);
});
