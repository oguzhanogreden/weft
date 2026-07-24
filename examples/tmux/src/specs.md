# Spec: `examples/tmux` — browser terminal multiplexer on Weft

## Overview & Purpose

A tmux-style terminal multiplexer running in the browser, driven by a real shell over a
WebSocket-connected PTY. Its purpose is to stress Weft's reactive DOM engine with the
canonical worst case (a terminal grid repainting tens of thousands of cells per second) while
exercising interactivity (keystrokes, prefix keybindings, focus) and streaming (PTY output as
an Effect `Stream`). It doubles as the repository's first performance benchmark.

The independent variable is _how many live reactive nodes/subscriptions update per frame_, not
"per-cell vs per-row." The example makes that explicit via three switchable render modes and
measures where each caps out.

## Acceptance Criteria

Status legend: ✅ implemented + verified · 🚧 pending · ⏭ deferred (post-v1).

### AC-GRID — pure grid model (`src/grid.ts`) ✅

- Copy-on-write at row granularity: an op touching one row returns a new `TerminalState`
  whose untouched rows keep their exact array reference. (Verified: the reactive skip relies
  on this identity.)
- `putChar` writes at the cursor, advances the column, and wraps to the next line at the right
  edge, scrolling when on the last row.
- `lineFeed`/`carriageReturn`/`setCursor`/`eraseInLine`/`eraseInDisplay`/`resize` behave per
  VT semantics; all clamp the cursor to the grid and never throw on out-of-range access.
- Alternate-screen enter/leave preserves and restores the main buffer + cursor.

### AC-ANSI — VT parser subset (`src/ansi/parser.ts`) ✅

- Chunk-safe: an escape sequence split across two `feed` calls parses identically to the whole
  string in one call (scan state lives in `Parser`, not `TerminalState`). (Verified.)
- Handles: printable text, CR/LF/BS/TAB/BEL, CUP (`H`/`f`), cursor moves (`A`/`B`/`C`/`D`),
  CHA (`G`), VPA (`d`), ED (`J`), EL (`K`), SGR (`m`: reset/bold/italic/underline/inverse,
  16-colour, bright, `38;5;n`/`48;5;n` 256-colour, truecolor collapsed to default), cursor
  save/restore (`s`/`u`, `ESC 7`/`ESC 8`), alternate screen (`ESC[?1049h/l`), and OSC strings
  (consumed, not rendered).
- **Acceptance gate for milestone 2:** must render `bash`, `vim`, and `htop` legibly.
- ⏭ Deferred: insert/delete line/char (`L`/`M`/`P`/`@`), mouse modes, G1 + locking shifts
  (SO/SI, `0x0E`/`0x0F`). Scroll regions (`r`) + `ECH` (`X`) now handled (see AC-SCROLLREGION);
  G0 DEC Special Graphics see AC-CHARSET. Documented, not silent.

### AC-CHARSET — G0 DEC Special Graphics (`src/ansi/parser.ts`) 🚧

The reason real `tmux`/`vim`/`ncurses` borders currently render as literal `q`/`x`/`l` letters:
the parser swallows the charset designation and passes the letters through. This makes G0
line-drawing legible. Scope is G0 only, which is provably sufficient: the backend advertises
`xterm-256color`, whose `smacs`/`rmacs` are `ESC(0`/`ESC(B` (G0 designation, no SO/SI, no G1).

- `ESC(0` designates the DEC Special Graphics set for G0; `ESC(B` restores ASCII. Both are
  consumed (never rendered) and toggle a `g0` charset field on `Parser`.
- While G0 is graphics, printable bytes `0x5F`–`0x7E` are translated to their Unicode glyph via
  the standard VT100 table (`q`→`─`, `x`→`│`, `l`/`k`/`m`/`j`→`┌`/`┐`/`└`/`┘`,
  `t`/`u`/`v`/`w`→`├`/`┤`/`┴`/`┬`, `n`→`┼`, `a`→`▒`, `` ` ``→`◆`, ...). Bytes `0x20`–`0x5E`
  pass through unchanged even in graphics mode.
- The translated glyph is stored resolved in `Cell.char`. The grid model and renderer stay
  charset-agnostic (zero diff): `rowToText` of a border row yields box-drawing glyphs.
- Chunk-safe: `g0` lives on `Parser` and is preserved in `feed`'s return, so `ESC(0` in one
  `feed` call and `qqq` in the next renders `───`, identical to feeding the whole string. This
  extends the AC-ANSI chunk-safety invariant to charset state.
- `initParser` starts in ASCII (`g0: "ascii"`). Designation persists across screen clears and
  alternate-screen switches until re-designated (matches VT: no implicit reset).
- ⏭ Out of scope (still deferred, see AC-ANSI): G1, locking shifts SO/SI (`0x0E`/`0x0F`), other
  94-char sets.

### AC-SCROLLREGION — scroll regions + ECH (`src/grid.ts`, `src/ansi/parser.ts`) ✅

`tmux attach` (and any TUI that pins a status row) currently bleeds: the pinned row scrolls into
the content and cleared cells keep stale glyphs. Root cause, from the PTY capture
(`/tmp/pty-capture-*.log`): the emulator drops `DECSTBM` (748x, including `ESC[1;23r` reserving
row 24 for the tmux status bar) and `ECH` (3863x), and scrolls the whole screen instead of the
region. Honoring both makes dynamic redraws render correctly. Scope is targeted to the bleed.

- **DECSTBM (`ESC[Ps;Ps r`)** sets the scroll region as top/bottom margins on `TerminalState`
  (1-based inclusive params, converted to 0-based). `ESC[r` with no params resets to full screen.
  An invalid region (top >= bottom, or out of range) resets to full screen. Setting the region
  homes the cursor to origin (0,0), per VT with origin mode off.
- **Region-aware scroll:** `scrollUp`/`scrollDown(n)` shift content only within
  `[scrollTop, scrollBottom]`, filling vacated lines with blank rows. Rows outside the region
  keep their exact array reference (the copy-on-write identity the reactive renderer skips on);
  only in-region rows get new references.
- **`lineFeed`** scrolls the region when the cursor is on the bottom margin
  (`cursorRow === scrollBottom`); otherwise it moves the cursor down, clamped. With the region at
  full screen this is identical to the previous whole-screen scroll (non-regression).
- **ECH (`ESC[Ps X`)** blanks `Ps` cells (default 1) from the cursor without moving it, fills
  with the current SGR style (matching `eraseInLine`), clamped to the row width, one-row
  copy-on-write.
- **SU/SD (`ESC[Ps S`/`T`)** scroll the region up/down by `Ps`, reusing the same helpers (a
  near-free correctness add; SU seen 1x, SD 0x in the capture).
- **Non-regression:** AC-GRID / AC-ANSI behavior is unchanged when no region is set, and the
  copy-on-write row identity holds for every row a scroll does not touch.
- ⏭ Out of scope (capture-proven absent): insert/delete line (`L`/`M`), `IND`/`RI`/`NEL`
  (`ESC D`/`M`/`E`), DEC charset, origin mode (`?6`). Documented, not silent.

### AC-TRANSPORT — I/O as an Effect Service (`src/transport.ts`) ✅

- `PtyTransport` is a `Context.Service`; the app depends only on the interface.
- `spawn({cols, rows})` yields a `PaneSession` (`output: Stream<Uint8Array>`, `write`,
  `resize`), `Scope`-bound so unmount runs the finalizer that closes the socket (the backend
  then kills the shell). No separate `kill` method; teardown is the scope finalizer.
- `PtyTransportWebSocketLive` wraps a browser `WebSocket` as an Effect `Stream` via
  `Stream.fromEventListener`. Validated live against the backend.
- `PtyTransportMockLive` emits a scripted byte `Stream` and records `write`s (tests/dev, no
  `node-pty` in CI).

### AC-RENDER — three switchable render levels (`src/terminal.ts`, `src/perf.ts`) ✅

- The level sets how many reactive text nodes each row is split into, isolating the real perf
  variable (live subscriptions firing per row change): `low` = 1 (whole line), `med` = 8
  segments, `high` = one per cell.
- One `SubscriptionRef<Row>` per row is the single source of truth. Switching level rebuilds
  only the render (a `List.each` keyed on the level); the parser pump feeding the refs persists.
- Changed-only rows update (untouched rows keep their ref and their subscriptions).
- `high` renders one `<span>` per cell with a reactive `style` prop (SGR fg/bg/bold/italic/
  underline/inverse, 16 + 256-colour) plus a reactive char, so it carries full colour at max
  node count. `low`/`med` stay monochrome text, the cheaper node-count baselines.

### AC-PIXELGRID — pixel-locked cell metrics (`src/terminal.ts`, `index.html`) ✅

The grid renders on fractional device pixels. Measured at the example's 13px monospace font
(`dpr` 1): cell advance `7.83px`, row height `16.25px` (`line-height: 1.25`). Columns do line up
row to row (measured cross-row spread `0`), so this is not a drift bug. The cost is that glyphs
land off pixel boundaries, so the whole grid reads soft, not crisp. This is the foundational
half of the "denser and pixel-sharp" goal (see `next-steps.md`); the density/resize half is
AC-RESIZE (feature B). Static size (80x24) is unchanged here.

- Cell advance is a whole number of device pixels: `cellAdvanceCss × devicePixelRatio` rounds to
  an integer (tolerance < 0.05px), for the example's monospace stack, at `dpr` 1 and 2.
- Row height is a whole number of device pixels: `rowHeightCss × devicePixelRatio` rounds to an
  integer. (Replaces `line-height: 1.25`, which yields fractional `16.25px`.)
- The lock is derived by measuring one rendered monospace cell at runtime (the
  `examples/element-ref` `getBoundingClientRect` pattern), not hardcoded, so it holds if the font
  stack resolves to a different monospace.
- All three render strategies (`low`/`med`/`high`) inherit the lock, since it is a
  font-metric/layout property applied to the grid container, not a per-strategy concern.
- Non-regression: columns still align across rows (cross-row spread stays `0`) and the grid
  stays 80x24. Alignment is the invariant that must not break, not the thing being fixed.
- The lock computation is a pure helper (`measured metrics + dpr → integer-device-px cell/row`),
  unit-testable without a browser; the applied result is asserted in the browser (AC-TEST).

### AC-INPUT — keystrokes to the terminal ✅

- Key events on the terminal call `session.write` with the encoded bytes (`encodeKey` maps
  Enter/Backspace/Tab/arrows/Ctrl-letters). Multi-pane focus routing lands with AC-MUX.

### AC-MUX — multiplexer chrome (`src/multiplexer.ts`) 🚧

- Split panes (`%` vertical, `"` horizontal), windows/tabs (`c`/`n`/`p`), status bar with a
  live clock, focus (`arrows`), kill pane (`x`), detach (`d`) via a `Ctrl-b` prefix state
  machine over a global `keydown` stream.
- Focused pane shown via a reactive border class; layout ratios bound reactively.

### AC-PERF — instrumentation (`src/perf.ts`) ✅

- A live FPS meter (`requestAnimationFrame`, sampled every 500ms) and a rows/sec meter in the
  control bar.
- A synthetic load generator merged into the same parser pump, with off/low/med/high levels
  (~0/10/60/250 full-screen repaints per second), so any render level can be measured at any
  load. Changing the level takes effect immediately.

### AC-TEST 🚧 (unit + backend + hermetic browser done; mux assertions pending)

- Unit (`vp run test`): grid model ✅, ANSI parser ✅. Pixel-lock computation helper
  (measured metrics + dpr → integer-device-px cell/row) ✅ (AC-PIXELGRID). G0 DEC Special
  Graphics charset (table-driven: translation, pass-through, reset, chunk-split) 🚧 with
  AC-CHARSET. Scroll regions + ECH (table-driven: DECSTBM set/reset/invalid + cursor home,
  region scroll preserving out-of-region refs, region-aware `lineFeed`, `eraseChars`, and the
  distilled tmux-attach bleed scenario) ✅ with AC-SCROLLREGION. Keybinding state machine lands
  with AC-MUX.
- Backend integration (Node `node --test`, `server/server.test.ts`): spawns a real PTY and
  round-trips a typed command over `ws` ✅.
- Browser e2e (`vp run test:browser`): mount `App` with `PtyTransportMockLive`; assert streamed
  output renders, a keystroke reaches the mock write log, the FPS + rows/sec meters render, a
  selected load level drives rows/sec above zero, and a strategy switch keeps the grid ✅. A
  scripted `ESC(0`…`ESC(B` byte sequence renders box-drawing glyphs in the DOM 🚧 (AC-CHARSET,
  hermetic via the mock transport). A captured scroll-region sequence (`ESC[1;23r` + scrolling)
  replayed via the mock transport keeps the status row in place with no bleed ✅
  (AC-SCROLLREGION). Rendered cell advance and row height are whole device pixels
  (`× devicePixelRatio` is integer) once the grid is mounted ✅ (AC-PIXELGRID; the probe logic
  inverted to assert integrality, across all three strategies). The `Ctrl-b %` two-pane
  assertion lands with AC-MUX. A live
  real-PTY browser run (real shell →
  `transport-ws` → reactive DOM) was validated manually; not kept in CI, since it needs the
  backend.

### Skips

- **type-tests: not applicable.** The example exposes no generic/type-level public API worth a
  TSTyche assertion; its contracts are runtime behaviours covered by unit + browser tests.
  - AC-PIXELGRID specifically: `CellMetrics`/`PixelLock` are plain concrete interfaces and
    `computePixelLock`/`measureCell`/`pixelLockStyle` are non-generic fixed-signature functions.
    No generics, overloads, or conditional/inferred types, so the main typecheck already enforces
    the whole surface; a TSTyche assertion would only restate the signatures.
  - AC-SCROLLREGION specifically: `setScrollRegion`/`scrollUp`/`scrollDown`/`eraseChars` and the
    new `dispatchCsi` cases are non-generic fixed-signature functions over `TerminalState`; no
    type-level surface to assert.

## Notes / accepted deviations

- Not single-command self-contained: a real run needs the `server/` PTY backend started
  separately (`node-pty` native addon). The mock transport keeps `app.ts` importable and the
  browser test hermetic. Accepted per the approved plan.
