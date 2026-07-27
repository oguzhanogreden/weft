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
  whole device pixels (every strategy inherits the lock).
- Grid size as a third harness axis: five presets (80x24 to 240x60) switch at runtime, tearing
  down the old refs/pump/subscriptions and calling `session.resize`. Unit- and browser-tested.
- Auto-fit: the grid derives its size from the viewport on load and on every debounced resize,
  clamped to the top preset. A preset click pins it; `auto` resumes tracking.
- Touch input: a hidden textarea summons the soft keyboard, an accessory row supplies
  Esc/Tab/arrows, and a sticky Ctrl makes `Ctrl-C` reachable. Controls collapse on narrow screens.
- Cell integrity: every cell renders a character, blanks included. The ~0.15% of cells that used
  to come out empty were a `@weftui/dom` defect (a reactive child's first emission discarded when
  it arrived before its markers were attached), fixed there and guarded in both packages.
- Scroll regions (DECSTBM `ESC[r`) + erase-character (`ESC[X`): the emulator scrolls inside a
  region and erases cell runs, so `tmux attach` renders without status-bar bleed.
- G0 DEC Special Graphics (`ESC(0`/`ESC(B`): pane borders draw as `┌─┐│└┘├┤┬┴┼`, not `lqk`
  letters. All 32 bytes of the table, unit- and browser-tested.
- Remote access: a running instance is reachable from another device over Tailscale (one HTTPS
  origin, `tailscale serve` proxying to both processes). Backend binds loopback only; an optional
  `PTY_TOKEN` gates the shell (constant-time compare, terminal on a wrong token, never retried);
  `TMUX_SESSION` makes a dropped connection reconnect into the same tmux session. Reconnect is
  automatic with exponential backoff, capped and eventually paused, shown as a status dot. Unit-,
  backend-, and browser-tested.

Rendering is single-pane. Colour renders per cell at the `high` strategy, now the default, so real
programs open in colour. The items below are ordered roughly by value.

## 1. Run real tmux (fidelity, not reinvention)

The backend spawns a real shell over a real PTY, so you can just run `tmux` (or `vim`, `htop`)
inside it. Real tmux draws its own splits, status bar, and prefix keys, emitting VT output that
our terminal renders. A Weft-native multiplexer is therefore not required for the headline goal.
Terminal fidelity is what makes real tmux render correctly. Scroll regions (DECSTBM) and
erase-character land, so `tmux attach` no longer bleeds the status bar into the content
(AC-SCROLLREGION). The DEC special-graphics charset lands too, so pane borders draw as box
glyphs instead of `q`/`x` letters (AC-CHARSET). What remains:

- Insert/delete line (`L`/`M`): vim and some TUIs shift lines this way. Absent from the tmux
  capture, so lower priority.
- 24-bit truecolor (`48;2;r;g;b`): collapsed to the terminal default today, so a truecolor
  selection band or theme colour goes missing. Map it to a CSS colour (part of item 2).

These overlap with item 5 (ANSI fidelity); together they are what make real `tmux` legible.

A Weft-native multiplexer (panes as Weft components, one PTY per pane via `PtyTransport.spawn`,
`Ctrl-b` prefix over a global `keydown` stream) stays an option if you want browser-native
splitting (per-pane scrollback, HTML overlays). It is no longer the priority.

## 2. Styled per-cell colour — landed, refinements open

The `high` strategy renders the grid model's `fg`/`bg`/`bold`/`italic`/`underline`/`inverse` as one
`<span>` per cell with inline colour, and `high` is now the default. So real programs open in
colour, including a menu's reverse-video selection band. `low`/`med` stay monochrome as the
node-count baselines (colour is a property of the real-use view, not the benchmark).

Open refinements:

- 24-bit truecolor (`48;2;r;g;b`) is collapsed to the terminal default; map it to a CSS colour so
  truecolor selection bands and themes render.
- Coalesce same-style runs into fewer `<span>`s for the real-use view if the per-cell node count
  becomes a bottleneck.

## 3. Mobile, resize, and remote access: landed, verification open

Auto-fit (AC-RESIZE), touch input (AC-MOBILE), and remote access (AC-REMOTE) all landed. The grid
fits the viewport on load and on every debounced resize, a preset click pins it and stops
tracking, and `auto` resumes. Touch input rides a hidden textarea plus an accessory row with a
sticky Ctrl. An instance is reachable from another device over Tailscale, with a token gate,
session persistence, and automatic reconnect. All three are unit-, backend-, or browser-tested.

What is not yet verified is the part none of those test layers can show:

- **Run it on a real phone, over a real tailnet.** Remote access removes the "same LAN as the dev
  server" requirement, so this is now practical rather than theoretical. The things to check are
  whether the keyboard opens on tap, whether sticky Ctrl survives the keyboard's own event
  handling, whether the keyboard's `resize` re-init is as unobtrusive as expected, and whether a
  real sleep/wake cycle reconnects as cleanly as the mock-driven tests say it should.
- **Landscape.** ~101 columns at 13px, so a rotation crosses many cell boundaries and triggers a
  full re-init. Worth confirming that feels acceptable rather than janky.
- **Consider a font-size control.** A phone fits ~43 columns at 13px and ~57 at 10px. Several
  TUIs need more than 43 to be usable at all, so a smaller font may matter more than any of the
  above.

Done when: a real phone, over a real tailnet, can drive a shell, including `Ctrl-C` and a
sleep/wake cycle, without a hardware keyboard or a shared LAN.

## 4. Two `@weftui/core` HTML-attribute defects (found from this example)

Both surfaced wiring the mobile textarea (AC-MOBILE), and both are core issues, so they were
worked around in the example rather than fixed in passing.

- **`spellcheck` is typed as a string but assigned as a boolean.** Core types it
  `HTMLAttributeSource<"true" | "false">`, but the renderer assigns it to the boolean IDL
  property, so the documented value `"false"` is a truthy string and turns spellcheck **on**. The
  element renders as `spellcheck="true"`. Any prop whose IDL property is boolean while the type
  is a string union has the same problem, so the fix is probably in the property/attribute
  decision in `packages/dom`, not in the one type. Worked around by setting it through the ref.
- **`HTMLAutocomplete` has no `"off"`.** The union lists field-name tokens only, so the
  spec-legal `autocomplete="off"` does not typecheck. Worked around by omitting it.

Done when: both can be expressed declaratively, and the example's workarounds are removed.

## 5. ANSI parser fidelity

Scroll regions (`r`) and erase-character (`X`) now land (AC-SCROLLREGION). Deferred gaps that
remain (documented in `src/specs.md`, AC-ANSI): insert/delete line/char (`L`/`M`/`P`/`@`), mouse
reporting, G1/locking-shift charset switching. Needed for full `vim`/`tmux`-in-`tmux` fidelity.
Add table-driven parser unit tests as each lands.

## 6. Browser-suite bundling flakiness (tooling, not this example)

`vp run test:browser` occasionally fails with `Duplicate export of 'OpenApi'`, a Rolldown
chunk-merge collision on `effect`'s httpapi namespace (pulled in via `@weftui/router`). It
surfaces above ~31 browser test files and is order/resource sensitive. Mitigated today by
`optimizeDeps: { include: ["effect"] }` in `vitest.browser.config.ts`; seen once in ~7 runs.

- Reproduce deterministically (run the full suite under load), then either harden the browser
  bundling (dep pre-bundling / chunking) or file it upstream against the effect beta.

Done when: the full browser suite is green across many consecutive runs under load.

## 7. Real-PTY browser test in CI (gated)

The live "real shell to reactive DOM" browser run was validated manually and not kept, because
it needs the backend and `node-pty` (absent from browser CI).

- Add an opt-in job that boots `server/` then runs a live `*.browser.test.ts` against it, gated
  behind an env flag so the default hermetic suite stays backend-free.

## 8. `DEVELOPMENT.md`

Written this cycle on a separate local branch (`worktree-agent-...`), not merged. Decide whether
to bring it onto this branch / `main`. It documents Node 26 via asdf, the no-corepack situation,
the `vp` install, the pack caveat, and Playwright setup.

## 9. Perf harness polish

- Record and display the FPS ceiling per strategy times load in a small results table.
- Add an unthrottled "max" load (emit every tick) to find the hard ceiling.
- Optionally add a styled per-cell strategy to measure colour's cost against monochrome.
