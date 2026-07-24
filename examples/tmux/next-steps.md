# tmux example: next steps

Roadmap for the remaining work on this example. Status of what exists lives in
`src/specs.md` (per-criterion). This file is the forward-looking plan.

## Where it stands

Done and validated on Node 26 (`vp run check` / `test` / `test:browser` green):

- Pure VT parser + copy-on-write grid model, unit-tested.
- `PtyTransport` service (mock + WebSocket layers) and the `node-pty` backend.
- Single terminal: per-row `SubscriptionRef` reactive rendering, keystroke input.
- Real PTY over WebSocket, end to end (backend integration test + a manual live browser run).
- Perf harness: FPS and rows/sec meters, strategy level (low/med/high) times load level
  (off/low/med/high).
- Pixel-locked grid: one cell is measured at runtime, then cell advance and row height snap to
  whole device pixels (every strategy inherits the lock). Grid size stays a fixed 80x24.

Rendering is monochrome and single-pane. The items below are ordered roughly by value.

## 1. Run real tmux (fidelity, not reinvention)

The backend spawns a real shell over a real PTY, so you can just run `tmux` (or `vim`, `htop`)
inside it. Real tmux draws its own splits, status bar, and prefix keys, emitting VT output that
our terminal renders. A Weft-native multiplexer is therefore not required for the headline goal.
What is required is terminal fidelity so real tmux renders correctly:

- DEC special-graphics charset (`ESC(0` / `ESC(B`): ncurses and tmux draw pane borders with
  line-drawing glyphs selected via this charset. We currently swallow the designation and pass
  the letters through, so borders show as `q`/`x` letters. Translate the DEC graphics set.
- Scroll regions (`ESC[r`) and insert/delete line (`L`/`M`): tmux and vim scroll within regions.
- Colour (item 2) for the status bar and content.

These overlap with item 4 (ANSI fidelity); together they are what make real `tmux` legible.

A Weft-native multiplexer (panes as Weft components, one PTY per pane via `PtyTransport.spawn`,
`Ctrl-b` prefix over a global `keydown` stream) stays an option if you want browser-native
splitting (per-pane scrollback, HTML overlays). It is no longer the priority.

## 2. Styled per-cell colour

The grid model already carries `fg`/`bg`/`bold`/`underline`/`inverse`; the renderer drops it.

- Render coalesced same-style runs as `<span>`s with inline colour for the real terminal view.
- Keep the perf harness monochrome (it isolates node count on purpose); colour is a property of
  the "use it for real" view, not the benchmark.

Done when: `vim`/`htop` render with their colours in the live example.

## 3. Dynamic sizing / resize

Grid is fixed at 80x24. The pixel-lock already measures one monospace cell at runtime
(`measureCell` / `getBoundingClientRect`, the `examples/element-ref` pattern), so the
measurement half exists; this item adds the density half on top of it.

- Reuse the measured cell metrics to compute cols/rows from the pane box, call `session.resize`,
  and re-init the grid on change.

Done when: resizing the window reflows the shell (`$COLUMNS`/`$LINES` update, `htop` reflows).

## 4. ANSI parser fidelity

Deferred v1 gaps (documented in `src/specs.md`, AC-ANSI): insert/delete line/char
(`L`/`M`/`P`/`@`), scroll regions (`r`), mouse reporting, charset switching. Needed for full
`vim`/`tmux`-in-`tmux` fidelity. Add table-driven parser unit tests as each lands.

## 5. Browser-suite bundling flakiness (tooling, not this example)

`vp run test:browser` occasionally fails with `Duplicate export of 'OpenApi'`, a Rolldown
chunk-merge collision on `effect`'s httpapi namespace (pulled in via `@weftui/router`). It
surfaces above ~31 browser test files and is order/resource sensitive. Mitigated today by
`optimizeDeps: { include: ["effect"] }` in `vitest.browser.config.ts`; seen once in ~7 runs.

- Reproduce deterministically (run the full suite under load), then either harden the browser
  bundling (dep pre-bundling / chunking) or file it upstream against the effect beta.

Done when: the full browser suite is green across many consecutive runs under load.

## 6. Real-PTY browser test in CI (gated)

The live "real shell to reactive DOM" browser run was validated manually and not kept, because
it needs the backend and `node-pty` (absent from browser CI).

- Add an opt-in job that boots `server/` then runs a live `*.browser.test.ts` against it, gated
  behind an env flag so the default hermetic suite stays backend-free.

## 7. `DEVELOPMENT.md`

Written this cycle on a separate local branch (`worktree-agent-...`), not merged. Decide whether
to bring it onto this branch / `main`. It documents Node 26 via asdf, the no-corepack situation,
the `vp` install, the pack caveat, and Playwright setup.

## 8. Perf harness polish

- Record and display the FPS ceiling per strategy times load in a small results table.
- Add an unthrottled "max" load (emit every tick) to find the hard ceiling.
- Optionally add a styled per-cell strategy to measure colour's cost against monochrome.
