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
  G0 DEC Special Graphics now handled (see AC-CHARSET). Documented, not silent.

### AC-CHARSET — G0 DEC Special Graphics (`src/ansi/parser.ts`) ✅

The reason real `tmux`/`vim`/`ncurses` borders used to render as literal `q`/`x`/`l` letters:
the parser swallowed the charset designation and passed the letters through. This makes G0
line-drawing legible. Scope is G0 only, which is provably sufficient: the backend advertises
`xterm-256color`, whose `smacs`/`rmacs` are `ESC(0`/`ESC(B` (G0 designation, no SO/SI, no G1).
Verified locally with `infocmp xterm-256color`, which lists `smacs=\E(0`, `rmacs=\E(B`, and no
`enacs`. The glyph table is xterm's, cross-checked entry by entry against the unit test's copy.

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
- The table is exposed as `translateG0(char)` so the unit tests can assert it entry by entry
  rather than only through `feed`.
- G1/G2/G3 designations (`ESC)`/`ESC*`/`ESC+`) are **consumed, not translated**: the designator
  byte is swallowed so it never prints as a stray glyph, and G0 is left alone. Without locking
  shifts those slots can never be invoked, so translating them would be dead code.
- ⏭ Out of scope (still deferred, see AC-ANSI): locking shifts SO/SI (`0x0E`/`0x0F`) and
  therefore any use of G1/G2/G3, other 94-char sets.

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
  (`ESC D`/`M`/`E`), origin mode (`?6`). Documented, not silent. (DEC charset was out of scope
  here too; it landed separately as AC-CHARSET.)

### AC-TRANSPORT — I/O as an Effect Service (`src/transport.ts`) ✅

- `PtyTransport` is a `Context.Service`; the app depends only on the interface.
- `spawn({cols, rows})` yields a `PaneSession` (`output: Stream<Uint8Array>`, `write`,
  `resize`), `Scope`-bound so unmount runs the finalizer that closes the socket (the backend
  then kills the shell). No separate `kill` method; teardown is the scope finalizer.
- `PtyTransportWebSocketLive` wraps a browser `WebSocket` as an Effect `Stream` via
  `Stream.fromEventListener`. Validated live against the backend.
- `PtyTransportMockLive` emits a scripted byte `Stream` and records `write`s (tests/dev, no
  `node-pty` in CI). It also records `resize`s as `(cols, rows)` pairs, so a browser test can
  assert the PTY was told about a grid-size change (AC-GRIDSIZE), not just that the DOM changed.

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
- The app opens in `high`, the coloured real-use view, so real programs render in colour out of
  the box (a menu's reverse-video selection band, a status bar). `low`/`med` are opt-in perf
  baselines selected from the control bar.
- Every cell renders a character, blanks included. Roughly 0.15% used to end up with an empty
  reactive region (a dropped glyph, and the rest of the row shifted left by one advance). The
  cause was in `@weftui/dom`, not here: a reactive child's first emission was discarded when it
  arrived before its markers were attached. Fixed there and guarded both in that package and by
  `render-integrity.browser.test.ts` here.

### AC-PIXELGRID — pixel-locked cell metrics (`src/terminal.ts`, `index.html`) ✅

The grid renders on fractional device pixels. Measured at the example's 13px monospace font
(`dpr` 1): cell advance `7.83px`, row height `16.25px` (`line-height: 1.25`). Columns do line up
row to row (measured cross-row spread `0`), so this is not a drift bug. The cost is that glyphs
land off pixel boundaries, so the whole grid reads soft, not crisp. This is the foundational
half of the "denser and pixel-sharp" goal (see `next-steps.md`). The density half is split in
two: manual preset sizes are AC-GRIDSIZE, automatic viewport-fitting stays AC-RESIZE. Size was
static (80x24) when this criterion landed; AC-GRIDSIZE now varies it without disturbing the lock.

- Cell advance is a whole number of device pixels: `cellAdvanceCss × devicePixelRatio` rounds to
  an integer (tolerance < 0.05px), for the example's monospace stack, at `dpr` 1 and 2.
- Row height is a whole number of device pixels: `rowHeightCss × devicePixelRatio` rounds to an
  integer. (Replaces `line-height: 1.25`, which yields fractional `16.25px`.)
- The lock is derived by measuring one rendered monospace cell at runtime (the
  `examples/element-ref` `getBoundingClientRect` pattern), not hardcoded, so it holds if the font
  stack resolves to a different monospace.
- All three render strategies (`low`/`med`/`high`) inherit the lock, since it is a
  font-metric/layout property applied to the grid container, not a per-strategy concern.
- Non-regression: columns still align across rows (cross-row spread stays `0`), at every size
  AC-GRIDSIZE offers. Alignment is the invariant that must not break, not the thing being fixed.
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

### AC-GRIDSIZE — runtime grid-size control (`src/app.ts`, `src/main.ts`) ✅

Makes grid size a third perf-harness axis alongside strategy × load, so the cost curve of Weft's
reactive DOM can be read against cell count rather than inferred from one fixed grid. 80x24 is
1,920 cells (3,840 live subscriptions at `high`); 240x60 is 14,400 (28,800). Finding where that
falls over is the point of the axis. This is the manual, benchmark-driven half of density;
automatic viewport-fitting on window resize stays AC-RESIZE.

- The control bar gains a `size` group of five preset buttons: 80x24, 120x40, 160x48, 200x50,
  240x60. Clicking one switches the grid with no page reload.
- The app opens at 160x48 (7,680 cells), the densest preset that still reads comfortably on a
  laptop display. The ladder still starts at the classic 80x24; that is the bottom rung, not the
  landing point. The default must be one of the presets, or the opening grid would match no
  button.
- Switching size fully re-inits: fresh row refs (`makeGrid`), a fresh parser pump at the new
  dimensions, and a fresh synthetic load stream sized to match. The previous size's refs, pump
  fiber, and every per-cell subscription are torn down before the new ones are built.
- Teardown is structural, not hand-rolled: the size-keyed `List.each` item scope owns them, and
  the renderer closes a dropped key's scope (interrupting its fibers) before rendering the new
  key. (`packages/dom/src/client/render.ts`: per-item scope forked in `renderItem`, closed in
  `reconcileList`; the render function's `Scope.Scope` is provided from that item scope.)
- `session.resize(cols, rows)` fires on every switch, so a real shell receives SIGWINCH and
  reflows (`$COLUMNS`/`$LINES` update).
- The grid blanks on switch and is repainted by the shell's redraw (or by the synthetic load).
  This matches a real terminal emulator; content preservation is deliberately not attempted.
- **Non-regression (AC-RENDER):** switching _strategy_ must still preserve grid content. The
  nesting enforces it: the outer `List.each` keyed on size owns the refs, the inner one keyed on
  strategy renders them, so a strategy change re-renders without touching the refs or the pump.
- **Non-regression (AC-PIXELGRID):** the measured pixel-lock survives a size switch. The probe
  span lives on the stable `.terminal-pane`, outside the size-keyed region, so the lock is
  measured once on mount and keeps cascading to every size.
- Initial size comes from `AppOptions` (`cols`/`rows`), seeded from the query string
  (`?cols=200&rows=50`) by `main.ts`. Values must be positive integers and are clamped to
  400x200, which bounds a typo to something that still renders rather than hanging the tab
  before first paint. The bound is deliberately generous (presets stop at 240x60), since finding
  the cliff is the point. Non-preset sizes are reachable only this way.
- Clicking a preset writes the size back via `history.replaceState`, so a reload keeps the
  current size and the URL stays shareable mid-benchmark.
- The grid must lay out at full width: `#root` grows to its content instead of capping at 960px.
  A clipped grid still takes the DOM writes, but the browser skips paint for the hidden part, so
  a width cap makes the FPS meter read better than the truth.
- The FPS and rows/sec meters are mount-scoped and shared across sizes. They sample on a 500ms
  window that zeroes its counters each tick, so a reading is clean within half a second of a
  switch. No explicit meter reset is needed.

Expected behaviour and edge cases:

- **Mock-only replay divergence.** `PtyTransportMockLive`'s output is `Stream.fromIterable`, so
  every new subscription replays the scripted chunks from the start and the grid refills after a
  switch. `transport-ws`'s output is `Stream.fromEventListener`, which delivers only future
  events, so a real switch blanks until the shell redraws. The browser test must not be read as
  evidence that content survives a resize in production.
- **Transient double subscription on switch.** The renderer builds a new key's item before
  closing the dropped key's scope, so for that instant both pumps are subscribed to
  `session.output` and both feed `rate.bump`. The rows/sec meter double-counts across a switch.
  It self-clears on the next 500ms sample, and it is a measurement artefact of the tool rather
  than of Weft, so it is recorded rather than worked around.
- The AC-RENDER dropped-cell defect used to scale with cell count (roughly 3 cells at 80x24, 22 at
  240x60), which made the larger presets look far worse than the renderer actually was. Fixed in
  `@weftui/dom`; the larger presets are now a fair reading of render quality.
- 240x60 is roughly 1,880 × 975 CSS px at the 13px font, larger than many viewports. Zoom out
  before reading the FPS meter, and reload after zooming, since the pixel-lock reads
  `devicePixelRatio` once at mount.

### AC-RESIZE — auto-fit the grid to the viewport (`src/grid-size.ts`, `src/app.ts`) ✅

The automatic counterpart to AC-GRIDSIZE, and the reason the example works on a phone at all. A
390px portrait viewport holds about 43 columns at the 13px font; any fixed preset either
overflows it or wastes it. AC-GRIDSIZE built the re-init machinery and AC-PIXELGRID measures the
cell, so this criterion is mostly deriving a size instead of choosing one.

- A pure helper turns a pane box plus measured cell metrics into a `GridSize`:
  `cols = floor(width / cellWidth)`, `rows = floor(height / rowHeight)`. Unit-testable with no
  DOM, like `computePixelLock`.
- Measuring the available space must not be circular. `#root` is `fit-content`, so the pane is
  sized _by_ the grid inside it; measuring the pane's width to choose that grid's width would
  feed back on itself. `measureAvailableBox` therefore reads `documentElement.clientWidth` (never
  content-driven) less the body padding, and takes only the pane's `top`, which depends on the
  chrome above and never on the grid. `#root` also carries `min-width: 100%` so a fitted grid
  never leaves the root narrower than the viewport.
- The result is clamped to `AUTO_FIT_MAX`, which is the top preset (240x60). Auto-fit on a 2560px
  display would otherwise compute ~327x82, roughly 26,800 cells: nearly double the heaviest size
  proven to build, so the example would open on its own worst case. Past the cap the pane simply
  stops filling the window. Named constant, so raising it is one line.
- A floor keeps a tiny viewport from computing a degenerate grid; the size never goes below
  20x5.
- Tracking uses `Stream.fromEventListener(window, "resize")`, the primitive already used by
  `headless-menu` and `transport-ws`. Rotation fires `resize`, so no `orientationchange` handler
  and no `ResizeObserver` (which would be the codebase's first, and is not needed while the pane
  tracks the viewport).
- Resize is debounced (~150ms settle) so dragging a window edge re-inits once, not per pixel.
  Each re-init tears down a full grid, so an undebounced drag would thrash.
- **Auto by default, preset pins.** The app starts tracking. Clicking any preset pins that size
  and stops tracking; an `auto` button, first in the size group, resumes it. A `?cols=`/`?rows=`
  URL pins on load, since it is an explicit choice.
- Re-init reuses the AC-GRIDSIZE path unchanged: same size ref, same nested `List.each`, same
  `session.resize`. Auto-fit only decides _what_ to set, never _how_.
- `DEFAULT_GRID_SIZE` (160x48) changes role to the pre-measurement fallback: the size shown until
  the pixel-lock resolves, and the one auto-fit falls back to if measurement fails. It remains
  the pinned default whenever tracking is off.
- A computed size equal to the current one must not re-init. The size-keyed list gives this free
  (same label, same key, no rebuild), but it is an invariant worth asserting: a resize that does
  not cross a cell boundary should be inert.

### AC-MOBILE — touch input and responsive chrome (`src/app.ts`, `index.html`) ✅

Auto-fit makes the grid _fit_ a phone; this makes it _usable_ on one. A soft keyboard has no Esc,
Tab, Ctrl, or arrows, which are most of what driving a shell needs, and it does not open at all
without a focused form control.

- A visually hidden `<textarea>` holds focus and summons the soft keyboard when the pane is
  tapped. A textarea, not `contenteditable`, following xterm.js: it is the control mobile
  keyboards behave most predictably with. `autocapitalize` and `autocorrect` are off, and
  `spellcheck` is false, or the keyboard will capitalise and autocorrect shell input.
  - Deviation: `autocomplete="off"` is **not** set, though the HTML spec allows it.
    `@weftui/core`'s `HTMLAutocomplete` union lists field-name tokens only and has no `"off"`, so
    it does not typecheck. Autofill on an unnamed hidden textarea is not a realistic risk.
  - Deviation: `spellcheck` is set imperatively through the element ref, not as a prop. Core
    types it `"true" | "false"`, but the renderer assigns it to the **boolean** IDL property,
    where the string `"false"` is truthy: the element rendered as `spellcheck="true"`, the exact
    opposite of what was written. Caught by the browser test, which asserts the IDL property
    rather than the attribute for precisely this reason.
  - Both are `packages/core` defects rather than example concerns, so they are worked around
    here and recorded in `next-steps.md` rather than fixed in passing.
- Printable input is read from the `input` event, not `keydown`. Mobile keyboards frequently
  report `key: "Unidentified"` on `keydown`, so `encodeKey` alone would drop most typing. The
  textarea is cleared after each read. `keydown` still handles the named keys (Enter, Backspace,
  arrows) that report correctly, so desktop behaviour is unchanged.
- An accessory row provides `esc`, `tab`, `ctrl`, and the four arrows, sending the same bytes
  `encodeKey` produces. Shown only under `@media (pointer: coarse)`, so desktop is untouched.
- `ctrl` is a sticky one-shot modifier: tapping it arms it (visually marked), the next printable
  character is sent as its control byte (`0x01`-`0x1a`), and it disarms. Tapping it again
  disarms without sending. This is what makes Ctrl-C, Ctrl-D, and the `Ctrl-b` tmux prefix
  reachable.
- On narrow screens the strategy/load/size groups collapse behind a toggle, leaving the toggle
  and both meters on one line. The meters stay visible because watching them is the point of the
  harness. Desktop keeps the expanded bar, so existing tests click the same buttons.
- Pinch zoom stays enabled. The existing `width=device-width` viewport meta is sufficient.

Expected behaviour and edge cases:

- The soft keyboard shrinks the visual viewport, which fires `resize`, which re-fits the grid
  while typing. Fitting to the shrunken height is correct (the grid really is smaller), but it
  means opening the keyboard re-inits the grid once. The debounce keeps it to one.
- Sticky `ctrl` applies to the _next printable character only_, including one arriving via the
  soft keyboard's `input` event, not just `keydown`.
- Tapping the pane must not scroll it away under the keyboard; the pane is focused rather than
  scrolled into view.

### AC-TEST 🚧 (unit + backend + hermetic browser done; mux assertions pending)

- Unit (`vp run test`): grid model ✅, ANSI parser ✅. Pixel-lock computation helper
  (measured metrics + dpr → integer-device-px cell/row) ✅ (AC-PIXELGRID). G0 DEC Special
  Graphics charset ✅ (AC-CHARSET; 12 cases, table-driven over all 32 bytes: translation,
  `0x20`-`0x5E` pass-through, `ESC(B` reset, two chunk splits, persistence across `ED` and the
  alternate screen, and the negative guards that `ESC)0`/`ESC*0`/`ESC+0` do not translate).
  Scroll regions + ECH (table-driven: DECSTBM set/reset/invalid + cursor home,
  region scroll preserving out-of-region refs, region-aware `lineFeed`, `eraseChars`, and the
  distilled tmux-attach bleed scenario) ✅ with AC-SCROLLREGION. Grid-size presets, labels, and
  URL parsing (fallback per dimension, non-integer/zero/negative rejection, clamping) ✅
  (AC-GRIDSIZE, 19 cases). The auto-fit computation (pane box + cell metrics + cap → `GridSize`,
  including the cap, the floor, and the inert sub-cell change) ✅ with AC-RESIZE, pure and
  DOM-free like `computePixelLock`. Touch encoding (`controlByte`, and every accessory key
  cross-checked against `encodeKey` so the two input routes cannot drift) ✅ with AC-MOBILE. Keybinding state machine lands with AC-MUX.
- Backend integration (Node `node --test`, `server/server.test.ts`): spawns a real PTY and
  round-trips a typed command over `ws` ✅.
- Browser e2e (`vp run test:browser`): mount `App` with `PtyTransportMockLive`; assert streamed
  output renders, a keystroke reaches the mock write log, the FPS + rows/sec meters render, a
  selected load level drives rows/sec above zero, and a strategy switch keeps the grid ✅. A
  scripted `ESC(0`…`ESC(B` byte sequence renders box-drawing glyphs in the DOM, and the same
  letters render as letters once `ESC(B` lands ✅ (AC-CHARSET, hermetic via the mock transport).
  Its companion asserts the example's monospace stack resolves every border glyph at the ASCII
  cell advance ✅, the AC-PIXELGRID column-alignment risk box-drawing glyphs carry (they are
  East-Asian-Ambiguous width). It measures a probe span directly rather than grid cells, so it
  stays a font-metric assertion, which kept it valid while the AC-RENDER dropped-cell defect made
  grid-cell layout unreliable. Cell integrity itself is now covered directly:
  `render-integrity.browser.test.ts` asserts a full 80x24 screen and a sparse write leave zero
  cells without a character ✅.
  A captured scroll-region sequence (`ESC[1;23r` + scrolling)
  replayed via the mock transport keeps the status row in place with no bleed ✅
  (AC-SCROLLREGION). Rendered cell advance and row height are whole device pixels
  (`× devicePixelRatio` is integer) once the grid is mounted ✅ (AC-PIXELGRID; the probe logic
  inverted to assert integrality, across all three strategies). Clicking a size preset re-inits
  the grid to the new dimensions _and_ records the matching `session.resize(cols, rows)` on the
  mock ✅ (AC-GRIDSIZE; both halves asserted together, since DOM reflow and PTY notification can
  break independently), with a strategy switch after a size switch still preserving grid content
  (the AC-RENDER non-regression the nesting exists to protect) and the pixel-lock surviving the
  switch. The top preset is covered explicitly: 240x60 builds all 14,400 cells correctly in about
  3.5s headless, so the step is slow, not structurally broken. Its frame rate under load is the
  open question, and that needs a real browser. Auto-fit derives a grid from a sized container,
  re-fits on `resize`, stops tracking once a preset is pinned, and resumes on `auto` ✅
  (AC-RESIZE). Tapping the pane focuses the hidden textarea, an `input` event reaches
  `session.write` (the path `keydown` misses on mobile), each accessory key sends its expected
  bytes, and armed `ctrl` turns the next character into its control byte ✅ (AC-MOBILE). The
  `Ctrl-b %` two-pane assertion lands with AC-MUX. A live
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
  - AC-RESIZE / AC-MOBILE specifically: the fit helper is a non-generic
    `(box, metrics) => GridSize`, and the mobile surface is DOM wiring plus a boolean modifier
    flag. No generics, overloads, or conditional/inferred types; the behaviour under test is
    measurement and input routing, both runtime concerns.
  - AC-GRIDSIZE specifically: `GridSize`/`AppOptions` are plain concrete interfaces of `number`
    fields and the presets are a `ReadonlyArray<GridSize>`. No generics, overloads, or
    conditional/inferred types, so the main typecheck already enforces the surface. The behaviour
    under test is teardown and re-init, which is a runtime concern (browser tests).
  - AC-CHARSET specifically: `Charset` is a two-member string-literal union, `Parser.g0` a
    concrete field of it, and `translateG0` a non-generic `(string) => string`. No generics,
    overloads, or conditional/inferred types, so the main typecheck already enforces the surface.
    The behaviour under test is the translation table, which is a runtime concern (unit tests).

## Notes / accepted deviations

- Not single-command self-contained: a real run needs the `server/` PTY backend started
  separately (`node-pty` native addon). The mock transport keeps `app.ts` importable and the
  browser test hermetic. Accepted per the approved plan.
