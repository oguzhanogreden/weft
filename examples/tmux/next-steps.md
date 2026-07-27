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
- Read-only multi-viewer access: a second token (`PTY_VIEW_TOKEN`) grants a read-only
  `tmux attach -r` instead of the read-write shell, role decided server-side purely by which token
  matches. Built on tmux's own multi-client and `ignore-size` support (verified against the
  installed tmux's man page and empirically, not assumed) rather than a bespoke broadcast layer, so
  it needs `TMUX_SESSION` set. The presenter's control bar can share a viewer link (a one-time
  `view-token` WebSocket text frame, kept off the hot binary PTY-byte path); a viewer's screen is
  the grid and a status dot, nothing else. Unit-, backend-, and browser-tested, including an
  end-to-end backend test that a viewer's typed input never reaches the real shell.

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

## 3. Mobile, resize, remote access, and read-only viewing: landed, verification open

Auto-fit (AC-RESIZE), touch input (AC-MOBILE), remote access (AC-REMOTE), and read-only
multi-viewer access (AC-STREAM) all landed. The grid fits the viewport on load and on every
debounced resize, a preset click pins it and stops tracking, and `auto` resumes. Touch input rides
a hidden textarea plus an accessory row with a sticky Ctrl. An instance is reachable from another
device over Tailscale, with a token gate, session persistence, and automatic reconnect. A second
token grants read-only `tmux attach -r` access instead, shareable from the control bar. All four
are unit-, backend-, or browser-tested.

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
- **Share a link with an actual second device or person.** The backend test proves a viewer's
  input never reaches the shell; it does not prove watching feels smooth, that the share button's
  clipboard copy works on the presenter's actual device/browser, or that a viewer's own auto-fit
  settles cleanly on a phone-sized viewport.

Done when: a real phone, over a real tailnet, can drive a shell, including `Ctrl-C` and a
sleep/wake cycle, without a hardware keyboard or a shared LAN, and a second device can watch that
same session live via a shared read-only link.

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
Also tracked in `WEFT-FEEDBACK.md` at the repo root, alongside other framework-level
findings from across all examples.

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

`src/perf-sweep.bench.ts` records exactly this: FPS/rows-per-sec across strategy x load
(size pinned at 160x48) and strategy x size (load pinned at `med`). Run via `vp run bench`
(own config, `vitest.bench.config.ts`; excluded from `vp run test`/`test:browser`).

First run (2026-07-27, headless Chromium, SwiftShader software rendering, so treat as
relative not absolute): `low`/`med` hold the environment's fps ceiling through every load
level; `high` (one reactive node per cell) is fine at `load=off` but collapses once load
is applied, and its rows/s stops scaling with offered load past `med` (~600 rows/s ceiling
at 160x48, an 8x gap under `low`'s ~4800). Two cells in the size sweep (240x60 across all
strategies, 200x50/`low`) show depressed rows/s in lockstep with fps: that is
`makeLoadStream` outrunning the pump (no backpressure), not a real strategy/size reading.
Discriminator: a healthy cell's rows/s sits near its size's plateau; a saturated one
doesn't, regardless of strategy.

`perf-analysis.md` traced a real defect in `@weftui/dom`'s `handleStyle`: it reset and
reapplied every cell's inline style on every emission with no diffing against the
previous value, and predicted fixing it would close most of `high`'s gap under load.

That fix landed: `handleStyle`'s object branch now diffs against the previously-applied
object (`packages/dom/src/client/render.ts`, `dom.specs.md` AC13 kept its contract and
gained an implementation note), unit-tested including the string-then-object transition,
`vp run check`/`test`/`test:browser` all green. The prediction was falsified: `high`'s
rows/s at 160x48 under load moved from ~440 to ~490, not the several-fold jump toward
`med`'s ~2200-3900. The benchmark's load is zero-SGR (every cell's style was unchanged
tick over tick, the case the diff optimizes hardest), so this is a clean disconfirmation,
not noise. The leading hypothesis became per-cell subscription/fiber fan-out: `high`
opened two reactive bindings per cell (style + char) against one per segment for
`low`/`med`, a 40x gap in live bindings at 160 cols against the observed ~8x gap in
rows/s.

That hypothesis was confirmed and landed, then taken one step further. First, one binding
per cell (`renderCell`): `high`'s rows/s at 160x48 under load moved from ~490 to ~1410, a
~2.8x jump. A gap to `med`'s ~1900-3900 remained, and this document's own next-suspect
guess (per-cell DOM node count, 7,680 spans) turned out wrong: mechanistic reasoning about
finding #3 ("no rAF/microtask batching," falsified by reading Effect's scheduler source
directly, which already batches same-tick task dispatch) pointed at fiber-dispatch _count_
instead, one level up from the cell fix. Collapsing further, to one binding per _row_
(`renderRowHigh`, `ref`-mounted on the row `<div>`, one forked fiber looping over all
cells per row-change) closed the remaining gap entirely: `high` now reaches the same
120fps environment ceiling `low` and `med` hit, at 5083 rows/s under load at 160x48. See
`perf-analysis.md`'s Updates 2-4 for the full numbers, the falsified DOM-node-count guess,
and a test-timing gap this surfaced (`pixel-grid.browser.test.ts`'s post-switch wait
needed to check content, not just row count; fixed alongside). `render-integrity`, `app`,
`viewer-app`, `grid-size`, and `pixel-grid` browser tests all pass, `pixel-grid`
specifically re-run several times given the timing sensitivity involved. `vp run
check`/`test`/`test:browser` all green. There is no next suspect currently identified for
further gains at this size.

- Add backpressure (or a bounded queue) to `makeLoadStream` so a saturated size doesn't
  read as strategy noise.
- Add an unthrottled "max" load (emit every tick) to find the hard ceiling.
- Optionally add a styled per-cell strategy to measure colour's cost against monochrome.
