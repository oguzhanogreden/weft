import * as assert from "node:assert/strict";
import { parseSync } from "vite-plus";
import { describe, it } from "vite-plus/test";
import { effectUiPrune } from "./index";

/**
 * Invoke the plugin's `transform` hook against a stub plugin context exposing
 * just the `parse`/`warn` surface the hook uses. Returns the hook result plus the
 * collected warnings.
 */
function runTransform(
  code: string,
  id: string,
  options?: { ssr?: boolean },
): { result: { code: string } | undefined; warnings: string[] } {
  const warnings: string[] = [];
  const ctx = {
    // Mirrors the plugin context's `this.parse`: returns the ESTree Program.
    parse: (c: string) => parseSync("module.ts", c).program,
    warn: (message: string) => warnings.push(message),
  };
  const plugin = effectUiPrune();
  // The hook is authored as a plain function; call it with the stub `this`.
  const transform = plugin.transform as unknown as (
    this: typeof ctx,
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ) => { code: string } | undefined;
  const result = transform.call(ctx, code, id, options);
  return { result, warnings };
}

const CLIENT_MODULE = [
  `import { Boundary } from "@effect-ui/core";`,
  `export const App = () => Boundary.server(`,
  `  { load: () => x, provide: DatabaseLive, schema: Product },`,
  `  (d) => d,`,
  `);`,
].join("\n");

describe("effectUiPrune plugin", () => {
  it("is a build-only, post-enforced plugin with the documented name", () => {
    const plugin = effectUiPrune();
    assert.equal(plugin.name, "effect-ui:prune-server-boundary");
    assert.equal(plugin.apply, "build");
    assert.equal(plugin.enforce, "post");
  });

  describe("AC-1 — trigger", () => {
    it("strips load/provide on a client build (ssr falsy)", () => {
      const { result } = runTransform(CLIENT_MODULE, "/src/app.ts");
      assert.ok(result, "client build should transform the module");
      assert.ok(!result.code.includes("load:"));
      assert.ok(!result.code.includes("provide:"));
      assert.ok(!result.code.includes("DatabaseLive"));
      assert.ok(result.code.includes("schema: Product"));
    });

    it("is a no-op on the SSR build (ssr truthy)", () => {
      const { result } = runTransform(CLIENT_MODULE, "/src/app.ts", { ssr: true });
      assert.equal(result, undefined, "SSR build must retain load/provide");
    });
  });

  it("skips non-script ids", () => {
    const { result } = runTransform(CLIENT_MODULE, "/src/styles.css");
    assert.equal(result, undefined);
  });

  it("skips virtual modules", () => {
    const { result } = runTransform(CLIENT_MODULE, "\0virtual:thing");
    assert.equal(result, undefined);
  });

  it("returns undefined for modules without a Boundary.server call", () => {
    const code = `import { Boundary } from "@effect-ui/core";\nexport const x = Boundary.catchAll({}, []);`;
    const { result } = runTransform(code, "/src/other.ts");
    assert.equal(result, undefined);
  });

  describe("AC-5 — warning surfaced via this.warn", () => {
    it("emits a single warning for a non-static first argument", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `export const App = () => Boundary.server(props, (d) => d);`,
      ].join("\n");
      const { result, warnings } = runTransform(code, "/src/app.ts");
      assert.equal(result, undefined, "nothing changed, so no transform output");
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /could not be pruned|inline object literal/);
    });
  });
});
