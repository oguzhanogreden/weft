# `effectUiPrune` — the `Boundary.server` prune plugin

## Overview

`@effect-ui/vite` exports `effectUiPrune()`, a Vite plugin that, on the **client
(non-SSR) build**, strips the `load` and `provide` keys from every
`Boundary.server({ … }, render)` call site whose first argument is an inline
object literal. Removing those references lets the bundler tree-shake the
server-only code they reach (the `load` closure and the `provide` `Layer`, e.g.
`DatabaseLive`, plus their transitive imports) out of the client bundle.

This is the **second layer** of the `Boundary.server` bundle-safety strategy. The
first is the `ServerTag` type brand, which keeps server-only tags out of the
universal **types** and out of the client's requirement channel `R`. The brand
makes the client runtime-safe but not smaller — importing a `Layer` does not run
it, but it (and its imports) still ship. This plugin removes that residual weight.

It is **purely a bundle-size optimization**: the client renderer never reads
`load` or `provide` (it reads only `schema`, `render`, and — for typed-failure
replay — `failure`), so removing them cannot change client behaviour. The server
build retains every key.

## Why a transform, not a type/runtime change

The universal node descriptor produced by `Boundary.server` statically references
its `load` thunk and `provide` `Layer`. Those references survive into the client
graph even though `hydrate` never calls them. Only a build-time AST rewrite that
removes the references enables standard dead-code elimination to drop the
server-only subgraph.

## Approach

- **Version-agnostic** across Vite 7 and Vite 8: uses the plugin context's ESTree
  parser (`this.parse`, acorn on V7 / Oxc on V8) and `MagicString` for
  range-based, source-map-preserving edits. No Babel, no esbuild AST, no
  regex/string matching.
- Plugin object: `{ name: "effect-ui:prune-server-boundary", enforce: "post",
apply: "build", transform }`.
  - `enforce: "post"` so the hook receives already-transpiled JS (TS types
    stripped) while ESM imports are still intact at the per-module transform
    stage, so import-binding analysis is valid.
  - `apply: "build"` scopes the plugin to production builds; dev is left
    runtime-safe-but-larger and HMR is unaffected.
- **Match rule (import-binding-aware):** resolve the local binding(s) of
  `Boundary` imported from `@effect-ui/core` (including aliases,
  `import { Boundary as B }`). Match `MemberExpression` calls
  `<binding>.server(…)`. A binding shadowed by an inner declaration is **not**
  matched. Prune only when the first argument is an inline `ObjectExpression`
  with no `SpreadElement`; otherwise skip and emit a build warning.
- **Strip shape:** remove the `load` and `provide` `Property` nodes (and their
  separating commas) entirely. Retain `schema`, `render` (the second argument),
  and `failure`.

## Acceptance criteria

- **AC-1 (trigger):** On a client build (`options.ssr` falsy) the plugin
  transforms matching modules. On the SSR build (`options.ssr` truthy) it is a
  **no-op** — `load`/`provide` are retained.
- **AC-2 (strip):** For a matched `Boundary.server` call with an inline-literal
  first argument, the emitted object **omits `load` and `provide`** and **retains
  `schema` and `failure`** (and the `render` argument). Output is valid JS
  accompanied by a source map.
- **AC-3 (tree-shake enablement):** With `load`/`provide` removed, a server-only
  identifier reachable only through them (e.g. `DatabaseLive`) is **absent from
  the client bundle** and **present in the SSR bundle**. The plugin removes the
  _reference_; the elimination itself is standard DCE and assumes the server-only
  module has no other reference and no import side effects.
- **AC-4 (match precision):** Only `<Boundary-binding>.server(…)` where
  `Boundary` is imported from `@effect-ui/core` is rewritten. An unrelated
  `foo.server(…)`, a `.server(…)` on a shadowed local binding, and a
  computed/dynamic member access are **untouched**. Aliased imports
  (`import { Boundary as B }`) match via the binding, not the text.
- **AC-5 (non-static skip + warn):** A first argument that is a variable, a
  spread (`{ ...base }`), or otherwise not an inline object literal is **not**
  rewritten and produces a single `this.warn` identifying the module/location;
  the build still succeeds.
- **AC-6 (idempotent / non-matching no-op):** A module with no matching
  `Boundary.server` call returns `undefined` (no transform, no map churn).
  Re-running on already-pruned code (object literal lacking `load`/`provide`) is a
  no-op with no warning.
- **AC-7 (correctness preserved):** A client `hydrate` of a pruned build still
  replays success payloads (v1) and typed-failure payloads (v2) — `load` never
  ran on the client, so behaviour is unchanged.

## Configuration

```ts
export interface PruneOptions {
  readonly include?: FilterPattern;
  readonly exclude?: FilterPattern;
}
export function effectUiPrune(options?: PruneOptions): Plugin;
```

`include`/`exclude` follow Vite's `createFilter` semantics (glob or `RegExp`,
matched against module ids). Omitted, every non-virtual JS/TS module is eligible;
modules that contain no matching call are returned untouched regardless.

## Known limitations

- **Inline object literal only.** A spread or an out-of-line props object is
  skipped (with a warning). This keeps the rewrite provably safe — the plugin
  never has to reason about values it cannot see at the call site.
- **Namespace imports** (`import * as Core from "@effect-ui/core"` then
  `Core.Boundary.server(…)`) are not matched; use a named import.
- DCE is the bundler's job. The plugin only removes the references; whether the
  server-only module is actually dropped depends on it being otherwise unreferenced
  and free of import side effects.
