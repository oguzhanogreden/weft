import { createFilter, type FilterPattern, type Plugin } from "vite-plus";
import { type AstNode, pruneServerBoundaries } from "~/prune";

/**
 * Options for {@link effectUiPrune}. `include`/`exclude` follow Vite's
 * `createFilter` semantics (glob string, `RegExp`, or array thereof, matched
 * against module ids). When omitted, every non-virtual JS/TS module is eligible;
 * modules without a matching `Boundary.server` call are left untouched anyway.
 */
export interface PruneOptions {
  readonly include?: FilterPattern;
  readonly exclude?: FilterPattern;
}

/** Matches JS/TS module ids (optionally with a `c`/`m` modifier and `x`). */
const SCRIPT_ID = /\.[cm]?[jt]sx?$/;

/**
 * Vite plugin that strips `load` and `provide` from `Boundary.server` call sites
 * on the **client (non-SSR) build**, enabling the bundler to tree-shake the
 * server-only code those keys reach out of the client bundle.
 *
 * The client renderer never reads `load`/`provide` (only `schema`, `render`, and
 * `failure`), so the rewrite is behaviour-preserving; it is purely a bundle-size
 * optimization layered on top of the `ServerTag` type brand. The SSR build is a
 * no-op — every key is retained there.
 *
 * Scoped to `apply: "build"` and `enforce: "post"` so it sees already-transpiled
 * JS with ESM imports still intact, keeping binding analysis valid on both Vite 7
 * (acorn) and Vite 8 (Oxc).
 *
 * @example
 * ```ts
 * import { defineConfig } from "vite";
 * import { effectUiPrune } from "@effect-ui/vite";
 *
 * export default defineConfig({ plugins: [effectUiPrune()] });
 * ```
 */
export function effectUiPrune(options?: PruneOptions): Plugin {
  const filter = createFilter(options?.include, options?.exclude);

  return {
    name: "effect-ui:prune-server-boundary",
    enforce: "post",
    apply: "build",
    transform(code, id, transformOptions) {
      // AC-1: never strip on the SSR build — the server reads load/provide.
      if (transformOptions?.ssr) return undefined;

      const cleanId = id.split("?", 1)[0]!;
      if (cleanId.startsWith("\0") || !SCRIPT_ID.test(cleanId)) return undefined;
      if (!filter(id)) return undefined;
      // Cheap pre-check: skip parsing modules that can't contain a match.
      if (!code.includes(".server")) return undefined;

      let program: AstNode;
      try {
        program = this.parse(code) as unknown as AstNode;
      } catch {
        // Not parseable as ESTree at this stage — leave it untouched.
        return undefined;
      }

      const result = pruneServerBoundaries(code, program);
      if (!result) return undefined;

      for (const warning of result.warnings) this.warn(warning.message, warning.pos);

      if (!result.changed) return undefined;
      return { code: result.code, map: result.map };
    },
  };
}
