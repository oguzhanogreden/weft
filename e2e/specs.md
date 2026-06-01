# End-to-End / Browser Testing

## Overview

This package's tests run against `@effect-ui/*` inside a **real browser** (Chromium)
instead of jsdom, using [Vitest browser mode](https://vitest.dev/guide/browser/)
with the [Playwright provider](https://vitest.dev/config/browser/playwright).

The Playwright provider ships bundled with Vite+ (`vite-plus/test/browser-playwright`),
so only the `playwright` package and its browser binaries are added to the
workspace. Browser tests are isolated from the default node/jsdom `vp test` run by
file-naming convention and a dedicated config.

## Conventions

- Browser test files use the `*.browser.test.{ts,tsx}` suffix.
- They are **excluded** from the default `vp test` run (see `test.exclude` in the
  root `vite.config.ts`) and **included** only by `vitest.browser.config.ts`.
- Test globals are imported from `vite-plus/test` (never from `vitest` directly),
  matching the rest of the repo.

## Running

```bash
vp run test:browser          # run all *.browser.test.* in headless Chromium
```

One-time setup (already wired into the workspace):

```bash
vp add -D playwright -w      # provider lib (provider itself is bundled in Vite+)
playwright install chromium  # download the browser binary
```

## Acceptance Criteria

- [ ] `vp run test:browser` boots a real Chromium instance via Playwright and runs
      every `*.browser.test.{ts,tsx}` file.
- [ ] The default `vp test` run does **not** pick up `*.browser.test.*` files.
- [ ] The smoke test asserts a real browser environment is present
      (`window` is an object, `navigator.userAgent` contains `Chrome`).
- [ ] The smoke test performs and observes a real DOM mutation
      (append a node, assert containment, remove it, assert removal).
- [ ] `.claude/worktrees/**` is never discovered by the browser test run.
- [ ] Every app under `examples/*` has a co-located `*.browser.test.ts` that mounts
      the example in a real browser and asserts its headline behaviour, and all of
      them pass under `vp run test:browser`.

## Example apps

Each app in `examples/` is split into a side-effect-free `app.ts` (or `src/app.ts`)
that **exports** `App`, and a thin entry (`main.ts`, or `entry-client.ts` for the
SSR examples) that mounts it and is referenced by `index.html`. Browser tests import
`App` directly and mount it into their own container, so they never depend on a dev
server. Notes from wiring these up:

- The mounted tree is appended a tick **after** `mount`'s Effect resolves, so assert
  initial state with `vi.waitFor` rather than synchronously.
- Component-level `Effect.fork` observers of `ref.changes` (auto-focus, measure) do
  not outlive an isolated `mount`; assert ref behaviour through on-demand reads in
  event handlers instead (see `examples/element-ref`).
- The test page has none of the example's `index.html` CSS, so don't assert on
  layout-derived pixel values.

## When to Use

Add a `*.browser.test.ts` file here (or co-located in a package) when behaviour
depends on real browser semantics that jsdom cannot faithfully reproduce — e.g.
layout, real event dispatch, hydration against a real parser, or rendering an
example app end-to-end.
