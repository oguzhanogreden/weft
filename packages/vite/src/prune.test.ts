import * as assert from "node:assert/strict";
import { parseSync } from "vite-plus";
import { describe, it } from "vite-plus/test";
import { type AstNode, pruneServerBoundaries } from "./prune";

/** Parse a source string to the ESTree program the prune core consumes. */
const parse = (code: string): AstNode => parseSync("module.ts", code).program as unknown as AstNode;

/** Run the prune core over a source string. */
const prune = (code: string) => pruneServerBoundaries(code, parse(code));

/**
 * Assert the rewrite produced valid JS. `parseSync` is **error-tolerant** — it
 * returns a `program` plus an `errors` array and never throws — so a plain
 * `doesNotThrow(() => parse(code))` would silently pass on invalid output like
 * `{ , }`. We must inspect `errors` to actually validate.
 */
const assertValid = (code: string): void => {
  const { errors } = parseSync("module.ts", code);
  assert.equal(errors.length, 0, `expected valid JS:\n${code}\n${JSON.stringify(errors)}`);
};

describe("pruneServerBoundaries", () => {
  describe("AC-2 — strips load/provide, retains schema/failure/render", () => {
    it("removes load and provide from an inline literal first argument", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `export const App = () => Boundary.server(`,
        `  { load: () => loadIt(), provide: DatabaseLive, schema: Product, failure: LoadError },`,
        `  (data) => render(data),`,
        `);`,
      ].join("\n");

      const result = prune(code);
      assert.ok(result, "expected a result");
      assert.equal(result.changed, true);
      assert.equal(result.warnings.length, 0);
      assert.ok(!result.code.includes("load:"), "load should be removed");
      assert.ok(!result.code.includes("provide:"), "provide should be removed");
      assert.ok(!result.code.includes("DatabaseLive"), "provide value reference should be gone");
      assert.ok(result.code.includes("schema: Product"), "schema retained");
      assert.ok(result.code.includes("failure: LoadError"), "failure retained");
      assert.ok(result.code.includes("(data) => render(data)"), "render argument retained");
      assert.ok(result.map, "a source map is produced");
      assertValid(result.code);
    });

    it("strips load/provide when they sit at the end of the object", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ schema: Product, load: () => x, provide: L }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(!result.code.includes("load"));
      assert.ok(!result.code.includes("provide"));
      assert.ok(result.code.includes("schema: Product"));
      assertValid(result.code);
    });

    it("strips load/provide interleaved with retained keys", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ load: a, schema: S, provide: P, failure: F }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(!result.code.includes("load:"));
      assert.ok(!result.code.includes("provide:"));
      assert.ok(result.code.includes("schema: S"));
      assert.ok(result.code.includes("failure: F"));
      assertValid(result.code);
    });

    it("strips a shorthand property (`{ provide }`)", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ schema: S, provide, load: a }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(!/\bprovide\b/.test(result.code), "shorthand provide removed");
      assert.ok(!/\bload\b/.test(result.code), "load removed");
      assert.ok(result.code.includes("schema: S"));
      assertValid(result.code);
    });

    it("strips a method-shorthand property (`{ load() {} }`)", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ schema: S, load() { return 1; } }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(!result.code.includes("load"), "method-shorthand load removed");
      assert.ok(result.code.includes("schema: S"));
      assertValid(result.code);
    });

    it("collapses an all-pruned object to valid JS even with a trailing comma", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ load: a, provide: b, }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(!result.code.includes("load"));
      assert.ok(!result.code.includes("provide"));
      // The dangling trailing comma must be swallowed — not left as `{ , }`.
      assertValid(result.code);
    });

    it("keeps a trailing comma valid when a property survives", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ schema: S, load: a, }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(!result.code.includes("load"));
      assert.ok(result.code.includes("schema: S"));
      assertValid(result.code);
    });

    it("emits a source map with mappings for the edits", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ load: a, provide: p, schema: S }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(result.map, "a source map object is produced");
      assert.ok(
        typeof result.map.mappings === "string" && result.map.mappings.length > 0,
        "the source map carries non-empty mappings",
      );
    });
  });

  // Guards the test helper itself: `parseSync` is error-tolerant, so a naive
  // `doesNotThrow` would pass on invalid JS — `assertValid` must catch it.
  describe("assertValid helper", () => {
    it("rejects syntactically invalid output", () => {
      assert.throws(() => assertValid("const n = x({ , }, r);"));
    });
  });

  describe("AC-4 — match precision", () => {
    it("matches an aliased import via its binding", () => {
      const code = [
        `import { Boundary as B } from "@effect-ui/core";`,
        `const n = B.server({ load: a, provide: p, schema: S }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(!result.code.includes("load"));
      assertValid(result.code);
    });

    it("leaves an unrelated .server call untouched", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = router.server({ load: a, provide: p, schema: S });`,
      ].join("\n");
      // Boundary is imported but the only `.server` call is on `router`.
      assert.equal(prune(code), null);
    });

    it("does not match a shadowed binding, but still prunes the live one", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `export const outer = Boundary.server({ load: a, provide: p, schema: S }, (d) => d);`,
        `function inner() {`,
        `  const Boundary = { server: (o, r) => r };`,
        `  return Boundary.server({ load: a, provide: p, schema: S }, (d) => d);`,
        `}`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      // The outer (module-scope) call is pruned: exactly one `load:`/`provide:`
      // pair remains — the shadowed inner one.
      assert.equal(result.code.match(/load:/g)?.length, 1);
      assert.equal(result.code.match(/provide:/g)?.length, 1);
      assertValid(result.code);
    });

    it("does not match a computed member access", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary["server"]({ load: a, provide: p, schema: S });`,
      ].join("\n");
      assert.equal(prune(code), null);
    });

    it("prunes a static string-literal computed key (`{ ['load']: a }`)", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ schema: S, ["load"]: a, ["provide"]: b }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      // `["load"]` is a statically-known string, identical in meaning to `load:`.
      assert.ok(result?.changed);
      assert.ok(!result.code.includes("load"));
      assert.ok(!result.code.includes("provide"));
      assert.ok(result.code.includes("schema: S"));
      assertValid(result.code);
    });

    it("does NOT prune a dynamic computed key (`{ [load]: a }`)", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ schema: S, [load]: a }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      // `[load]` is the *variable* load, not the property name — never prune it.
      assert.equal(result?.changed ?? false, false);
    });

    it("prunes getter-form load/provide (`{ get load() {} }`)", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server(`,
        `  { get load() { return f; }, get provide() { return L; }, schema: S },`,
        `  (d) => d,`,
        `);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      assert.ok(!result.code.includes("load"));
      assert.ok(!result.code.includes("provide"));
      assert.ok(result.code.includes("schema: S"));
      assertValid(result.code);
    });

    it("does not match a binding shadowed by a catch-clause param", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `try {} catch (Boundary) {`,
        `  Boundary.server({ load: a, provide: b, schema: S }, (d) => d);`,
        `}`,
      ].join("\n");
      // The catch param shadows the import — pruning it would corrupt unrelated code.
      assert.equal(prune(code), null);
    });

    it("does not match a binding shadowed by a block-scoped const", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `{`,
        `  const Boundary = { server: (o, r) => r };`,
        `  Boundary.server({ load: a, provide: b, schema: S }, (d) => d);`,
        `}`,
      ].join("\n");
      assert.equal(prune(code), null);
    });

    it("does not match a binding shadowed by a for-of loop variable", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `for (const Boundary of items) {`,
        `  Boundary.server({ load: a, provide: b, schema: S }, (d) => d);`,
        `}`,
      ].join("\n");
      assert.equal(prune(code), null);
    });

    it("still prunes a module-scope call when an unrelated block shadows it", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `export const outer = Boundary.server({ load: a, provide: b, schema: S }, (d) => d);`,
        `{`,
        `  const Boundary = { server: (o, r) => r };`,
        `  Boundary.server({ load: a, provide: b, schema: S }, (d) => d);`,
        `}`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result?.changed);
      // Only the shadowed (block-scoped) call retains load/provide.
      assert.equal(result.code.match(/load:/g)?.length, 1);
      assert.equal(result.code.match(/provide:/g)?.length, 1);
      assertValid(result.code);
    });

    it("returns null when @effect-ui/core is not imported", () => {
      const code = `const n = Boundary.server({ load: a, provide: p, schema: S });`;
      assert.equal(prune(code), null);
    });
  });

  describe("AC-5 — non-static first argument warns and skips", () => {
    it("warns and skips a spread object literal", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ ...base, schema: S }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result);
      assert.equal(result.changed, false);
      assert.equal(result.warnings.length, 1);
      assert.ok(typeof result.warnings[0]?.pos === "number");
    });

    it("warns and skips a variable first argument", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server(props, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result);
      assert.equal(result.changed, false);
      assert.equal(result.warnings.length, 1);
    });
  });

  describe("AC-6 — idempotent / non-matching no-op", () => {
    it("returns null for a module with no Boundary.server call", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.catchAll({ fallback: (e) => e }, []);`,
      ].join("\n");
      assert.equal(prune(code), null);
    });

    it("is a no-op on already-pruned code (no load/provide present)", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ schema: S, failure: F }, (d) => d);`,
      ].join("\n");
      const result = prune(code);
      assert.ok(result);
      assert.equal(result.changed, false);
      assert.equal(result.warnings.length, 0);
    });

    it("re-running on its own output changes nothing further", () => {
      const code = [
        `import { Boundary } from "@effect-ui/core";`,
        `const n = Boundary.server({ load: a, provide: p, schema: S }, (d) => d);`,
      ].join("\n");
      const first = prune(code);
      assert.ok(first?.changed);
      const second = prune(first.code);
      assert.equal(second?.changed ?? false, false);
    });
  });
});
