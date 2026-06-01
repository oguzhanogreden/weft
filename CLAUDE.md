# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`effect-ui` is a pnpm monorepo (`effect-ui-workspace`) implementing an Effect-based UI library with strict TypeScript configuration and modern tooling.

Workspace layout (see `pnpm-workspace.yaml`):

- `packages/*` — published library packages:
  - `@effect-ui/base` (`packages/base`) — shared primitives
  - `@effect-ui/core` (`packages/core`) — core combinators, sources, streams, boundaries
  - `@effect-ui/dom` (`packages/dom`) — DOM renderer with `./client` and `./server` entry points
- `examples/*` — standalone runnable example apps, each its own workspace package

## Requirements

- Node.js

See versions in package.json > engines. Package management and all tooling is handled by `vp` (Vite+).

## Development Commands

All commands use the `vp` CLI (Vite+). Run `vp help` for a full list.

### Building

```bash
vp build
```

Uses tsdown for fast TypeScript bundling.

### Testing

```bash
vp test            # Run all tests
vp test --watch    # Run tests in watch mode
```

Uses Vitest (via Vite+). Test files follow the pattern `src/**/*.test.{ts,tsx}`.

### Checking (format + lint + typecheck)

```bash
vp check           # Format, lint, and type-check all files
vp check --fix     # Auto-fix formatting and lint issues
```

**Important:** Always run `vp check --fix` after making changes, not individual lint/format commands.

## Architecture

### TypeScript Configuration

Strict TypeScript setup with:

- `noUncheckedIndexedAccess: true` - Array/object access returns possibly undefined
- `noImplicitReturns: true` - All code paths must return
- `strict: true` - All strict type-checking enabled
- `verbatimModuleSyntax: true` - Import/export syntax preserved
- `isolatedModules: true` - Each file must be transpilable independently
- `noUncheckedSideEffectImports: true` - Side-effect imports must be explicit

Path aliases (configured per package in `packages/*/tsconfig.json`, which extend `tsconfig.base.json`):

- `~/*` maps to that package's `./src/*`

### Code Style

**Toolchain:** This project uses Oxlint (linting) and Oxfmt (formatting) via Vite+, NOT ESLint or Biome.

Oxfmt enforces:

- Tab indentation
- Double quotes for strings

When ignoring lint rules, use Oxlint syntax:

- ✅ Correct: `// oxlint-disable-next-line <rule-name>`
- ❌ Wrong: `// eslint-disable-next-line` or `// biome-ignore`

### Project Structure

- `packages/*/src/` - Source TypeScript files for each library package
- `packages/*/dist/` - Build output (excluded from TypeScript compilation)
- `examples/*/` - Standalone runnable example apps, each its own workspace package with an `app.ts` entry point and `vite.config.ts`
- `docs/` - Documentation
- `plans/` - Design plans and specs
- ES modules only (`"type": "module"` in package.json)

### Examples

The `examples/` folder contains standalone workspace packages demonstrating specific patterns or features (e.g. `keyed-list`, `form-handling`, `ssr-hydration`).

**Rules for examples:**

- Every example must have a co-located README named `readme.md`
- Each example is a self-contained, runnable workspace package (depends on `@effect-ui/*` via `workspace:*`)
- Include a JSDoc header comment in `app.ts` explaining the example's purpose
- READMEs should include: Overview, Problem, Solution, How It Works, and When to Use sections
- Each example is split into a **side-effect-free `app.ts`** (or `src/app.ts`) that
  `export`s `App` — no top-level `mount`/`hydrate` call — and a thin entry
  (`main.ts`, or `entry-client.ts` for SSR examples) that mounts it and is the file
  referenced by `index.html`. This keeps `app.ts` importable by tests.
- Every example **must include at least one co-located `*.browser.test.ts`** that
  imports `App`, mounts it in a real browser, and asserts the example's headline
  behaviour. Browser tests use `vite-plus/test` globals (never `vitest` directly)
  and run via `vp run test:browser`. See `e2e/specs.md` for conventions and known
  pitfalls (post-mount render tick, ref observers, missing example CSS).

## Coding Standards

### Architecture & Patterns

- Use a hybrid approach combining functional and object-oriented programming
- Effect (effect.website) is the core library - use its patterns throughout
- Prefer Effect's error handling over try/catch (except when it significantly hurts ergonomics)
- Use Services and Layers for dependency injection
- Prefer `pipe(effect, ...)` over `effect.pipe(...)`

### TypeScript Standards

- Type assertions (`as`, `!`) only when we're "smarter" than the compiler
- `any` is allowed for generic type params and library interop only
- Use explicit type guards over implicit checks
- Prefer generic constraints over flexibility
- Treat data structures as immutable - use `readonly` extensively
- Prefer `Option` > `undefined` > `null` for optional values
- All checks should be type-level when possible
- Use Schema for validation of unknowns and I/O

### Naming Conventions

- Files: kebab-case (e.g., `user-service.ts`)
- Variables/functions: camelCase, with `is*`, `has*`, `should*` prefixes for booleans
- Types/Interfaces: PascalCase, no `I` prefix for interfaces
- Constants (shared): UPPER_SNAKE_CASE
- Prefer named exports; default exports only if absolutely necessary

### Documentation

- All exported functions, types, and values must have JSDoc comments
- JSDoc `@type` annotations can be omitted (TypeScript handles types)
- Include text descriptions for parameters when not self-explanatory
- Inline comments only when needed - avoid commenting obvious code
- TODOs and FIXMEs are acceptable
- Effect Schemas should include descriptions/annotations when not self-explanatory

### Testing

- Follow Test-Driven Development workflow: spec → mock → test → implement
- Co-locate test files (`*.test.ts`) next to source code
- `__tests__/` directory allowed for compound/integration tests and shared fixtures/helpers
- `__type-tests__/` directory for compile-time type tests (see Type Tests section below)
- Write thorough tests against the API surface and specifications in co-located `specs.md` files
- Test naming conventions:
  - Use `describe` for test grouping, `it` or `test` for individual test cases
  - Test case names should match or reference acceptance criteria from specs.md
- Coverage requirements:
  - All acceptance criteria from specs.md must be covered
  - Cover both happy paths and error paths
  - Test all possible error types defined in the Effect error union (expected errors)
  - Include edge cases defined in specifications
- Use Effect testing utilities for testing Effect code
- Real-browser end-to-end tests live in `*.browser.test.{ts,tsx}` files, run via
  `vp run test:browser` (Vitest browser mode + Playwright), and are excluded from
  the default `vp test` run. Every `examples/*` app must have one — see the
  Examples section above and `e2e/specs.md`.

### Type Tests

Type tests verify compile-time behavior for complex type-level features. They use `@ts-expect-error` comments to assert that certain code should NOT compile.

**Location:** `src/**/__type-tests__/*.test-d.ts`

**Running type tests:**

```bash
vp run check
```

**Rules:**

- Type test files use the `.test-d.ts` extension (convention from `tsd` and similar tools)
- Use `@ts-expect-error` to assert code that should fail to compile
- Type tests are excluded from the main `vp check` typecheck to avoid conflicts with other augmentations
- Each type test file should be self-contained and test a specific feature

**Example pattern:**

```typescript
// Should compile - valid usage
const _valid: SomeType = validValue;

// @ts-expect-error - Should NOT compile - invalid usage
const _invalid: SomeType = invalidValue;
```

### Specification Files

- Every new feature must have a co-located `specs.md` file (e.g., `dom/feature.ts`, `dom/feature.test.ts`, `dom/feature.specs.md`)
- Existing features without specs should get them retroactively when modified
- Every planning session must start with extensive specification discussion:
  - Ask questions to understand requirements, edge cases, and constraints
  - Draft specifications interactively with the user
  - Iterate on the spec until complete before writing implementation code
- Use "mock first, implement later" approach:
  - Before implementation, create comprehensive mocks using TypeScript's type system and `declare` keyword
  - Define complete API surface: classes/methods, function signatures, constants/variables, exports, type definitions
  - Review mocks to ensure they match specifications and types are complete
- Implementation rules:
  - Only begin actual implementation after mocks and tests are complete
  - Replace type-system level mocks (e.g., `declare` statements) with real code
  - Ensure implementation matches mock signatures exactly
  - Ensure implementation matches co-located specs.md files
  - If implementation reveals mocks/specs need changes: pause implementation and update specs/mocks first (maintain strict spec → mock → test → implement cycle)
  - After implementation: run `vp check --fix` and `vp test`
- Specs MUST include:
  - Feature overview and purpose
  - Detailed acceptance criteria
- Specs COULD include:
  - Technical requirements and constraints
  - Dependencies and integrations
  - Expected behavior and edge cases
- Follow a common structure with standard headings, but allow flexibility between specs

### Error Handling

- Use Effect's tagged errors as the primary error handling mechanism
- Error messages should be descriptive and include context/debugging info when useful
- Input validation required only for unsafe input (user input, `unknown` input)
- Handle errors at program edges when possible

### Module Organization

- Organize code by domain, within the relevant workspace package
- Barrel exports (`index.ts`) only for grouping application domains, e.g. in `@effect-ui/dom`:
  - `src/index.ts` - package root export
  - `src/client/index.ts` - client-side DOM renderer (`@effect-ui/dom/client`)
  - `src/server/index.ts` - server-side rendering (`@effect-ui/dom/server`)
- Avoid circular dependencies
- Use `/utils` only for common code that doesn't fit a specific domain

### Effect-Specific Patterns

- Prefer Effect logic throughout the codebase
- Use Effect Schema for data structures and validation
- Wrap functionality in Services when capabilities need to be shared across modules/components
- Manage runtimes only when explicitly required
- `Effect.gen` vs `pipe` depends on the specific feature and readability

### Code Reuse

- Wait for multiple use cases before abstracting - avoid premature abstraction
- Organize shared utilities by domain; use `/utils` only for cross-cutting concerns
- Duplication vs abstraction is case-by-case - prefer duplication over poor abstraction

### Performance

- Readability first, performance second
- Use memoization only when explicitly specified or instructed
- Be mindful of bundle size: import specific items, not `import * as X`
- `Effect.gen` vs `pipe` choice depends on the feature and readability

### Imports

- Use specific imports, avoid `import * as X`

## Meta Rules

- Always discuss new rules and rule changes in Q&A style. Ask a question and await the answer before asking the next question, until sufficient information is provided.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
