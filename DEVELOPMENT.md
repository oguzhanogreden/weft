# Development Setup

This guide covers setting up a local development environment for `weft-workspace`,
the pnpm monorepo behind Weft.

It complements `CLAUDE.md`. `CLAUDE.md` is the source of truth for command
semantics and coding standards. This file gives the concrete install and setup
steps to get from a fresh machine to a green `vp run check`.

## Prerequisites

You need three things: Node.js 26, the `vp` (Vite+) CLI, and pnpm 11. Vite+ can
manage pnpm for you, so the pnpm step is often automatic (see First-time setup).

### Operating system

Verified on macOS (Darwin, arm64). Linux works the same way. On Windows, use the
PowerShell install command noted below for `vp`; the rest of the flow is identical.

### Node.js 26 (via asdf)

`package.json` requires Node `>=26.2.0 <27` in its `engines` field. The repo's
`.npmrc` sets `engine-strict=true`, so an older Node hard-fails installs instead
of warning. Use a 26.x release. The latest at time of writing is `26.5.0`.

Install and pin it with [asdf](https://asdf-vm.com/):

```bash
asdf plugin add nodejs
asdf install nodejs 26.5.0
asdf local nodejs 26.5.0
```

`asdf local` writes a `.tool-versions` file pinning Node for this repo. You can
also create that file by hand with a single line:

```
nodejs 26.5.0
```

Confirm the version before continuing:

```bash
node --version   # v26.5.0
```

### pnpm 11 and the corepack situation

`package.json` declares `"packageManager": "pnpm@11.1.3"` and requires
`pnpm >=11.1.3 <12`. Normally that pin is honored through corepack.

Node 26 ships only `node`, `npm`, and `npx` in its bin directory. It does not
bundle corepack. That breaks the usual "corepack respects the pin" assumption.

You have three ways to get pnpm 11.1.3. In most setups you can skip all of them,
because Vite+ downloads the pinned pnpm itself during `vp install` (see First-time
setup). Reach for these only when invoking pnpm directly, or when not letting
Vite+ manage the install:

- Option A (recommended): install corepack, then enable it.

  ```bash
  npm install -g corepack@latest
  corepack enable
  ```

  After this, `pnpm` respects the pinned `pnpm@11.1.3`.

- Option B: install pnpm globally at the pinned version.

  ```bash
  npm install -g pnpm@11.1.3
  ```

- Option C: run pnpm ad hoc, no global install.

  ```bash
  npx --yes pnpm@11.1.3 install
  ```

### Vite+ (`vp`)

This repo's entire toolchain runs through the Vite+ CLI, `vp`. That covers package
management, build, test, lint, format, typecheck, and the task runner. It is not
plain vite, vitest, eslint, or biome.

Install the global `vp` CLI per the official Vite+ docs.

macOS / Linux:

```bash
curl -fsSL https://vite.plus | bash
```

Windows (PowerShell):

```powershell
irm https://vite.plus/ps1 | iex
```

Open a new shell, then verify:

```bash
vp help
```

Vite+ manages your global Node.js runtime and package manager. To opt out, run
`vp env off`. Docs live locally at `node_modules/vite-plus/docs` (after install)
and online at https://viteplus.dev/guide/.

## First-time setup

1. Clone the repo and enter it.

   ```bash
   git clone <repo-url> weft
   cd weft
   ```

2. Install Node 26 and pin it (see Prerequisites).

   ```bash
   asdf plugin add nodejs
   asdf install nodejs 26.5.0
   asdf local nodejs 26.5.0
   ```

3. Install dependencies. Vite+ reads the `packageManager` pin and downloads
   pnpm 11.1.3 for you, so no corepack is needed here.

   ```bash
   vp install
   ```

   Install runs a supply-chain lockfile verification step. If you are not using
   `vp`, run the equivalent with one of the pnpm options above (for example
   `npx --yes pnpm@11.1.3 install`).

4. Install Playwright browsers. Real-browser tests need them once per machine.

   ```bash
   npx playwright install
   ```

At this point `vp run check` should pass. If it does not, see Troubleshooting.

## Everyday commands

Validate through the `vp run <task>` tasks, never the bare `vp <command>`.

This is a monorepo. `@weftui/dom` and every `examples/*` app consume `@weftui/core`
and `@weftui/base` as workspace packages, resolved through their built `dist/`.
Cross-package typechecking is only correct after those packages are packed.

The tasks in `vite.config.ts` (`run.tasks`) each declare `dependsOn: ["pack"]`, so
`vp run` always rebuilds the packages first:

```bash
vp run check          # pack, then format + lint + typecheck
vp run test           # pack, then run node/jsdom unit tests
vp run test:browser   # pack, then run real-browser Playwright e2e tests
vp run test:types     # pack, then run TSTyche type tests (*.tst.ts)
```

Do not run bare `vp check` or `vp test` for validation. They skip `pack`, so
against stale or missing `dist/` they report false cross-package errors (for
example spurious `implicit any` from unresolved `@weftui/*` types).

`vp check --fix` auto-fixes formatting and lint. It is only safe right after a
pack, for the same reason.

Other useful commands:

```bash
vp install            # install dependencies
vp run dev            # start dev servers across the workspace
vp env doctor         # diagnose runtime and package-manager setup
```

## Optional

### Effect 4 source reference

`CLAUDE.md` documents a gitignored `effect-src/` shallow clone, used to look up
Effect 4 APIs. It is read-only reference material, not part of the workspace.

```bash
git clone --depth 1 https://github.com/Effect-TS/effect.git effect-src
```

Refresh an existing clone with `git -C effect-src pull --depth 1`.

### Example native backends

Some examples ship a standalone Node backend that depends on native addons. Those
addons are installed separately, outside the workspace, because native code needs
a per-Node-version rebuild and is not part of the Vite build.

The pattern: the backend lives in a `server/` directory with its own
`package.json` and is installed on demand. For example, the `tmux` example uses
`node-pty`:

```bash
cd examples/tmux/server && npm install && npm start
```

Consult the example's `readme.md` for the exact steps.

## Troubleshooting

### Install fails on the Node version

If `vp install` or a pnpm install aborts with an engine error, your Node is too
old. `engine-strict=true` turns the `engines` mismatch into a hard failure. Install
a 26.x release and pin it (see Prerequisites), then confirm with `node --version`.

### corepack is missing on Node 26

Node 26 does not bundle corepack, so `corepack enable` fails out of the box. Let
Vite+ manage pnpm through `vp install`, or install corepack first with
`npm install -g corepack@latest`. See the pnpm options in Prerequisites for
alternatives.

### False cross-package type errors

Errors like `implicit any` on `@weftui/*` imports, or unresolved workspace types,
usually mean you ran a bare `vp check`, `vp test`, or `vp check --fix` without a
prior pack. Run the packed task instead:

```bash
vp run check
```

### Something else looks wrong

Run the Vite+ doctor and include its output when asking for help:

```bash
vp env doctor
```
