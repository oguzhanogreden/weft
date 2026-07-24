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
- ⏭ Deferred: insert/delete line/char (`L`/`M`/`P`/`@`), scroll regions (`r`), mouse modes,
  full charset switching. Documented, not silent.

### AC-TRANSPORT — I/O as an Effect Service (`src/transport.ts`) ✅

- `PtyTransport` is a `Context.Service`; the app depends only on the interface.
- `spawn({cols, rows})` yields a `PaneSession` (`output: Stream<Uint8Array>`, `write`,
  `resize`), `Scope`-bound so unmount runs the finalizer that closes the socket (the backend
  then kills the shell). No separate `kill` method; teardown is the scope finalizer.
- `PtyTransportWebSocketLive` wraps a browser `WebSocket` as an Effect `Stream` via
  `Stream.fromEventListener`. Validated live against the backend.
- `PtyTransportMockLive` emits a scripted byte `Stream` and records `write`s (tests/dev, no
  `node-pty` in CI).

### AC-RENDER — three switchable render modes (`src/terminal.ts`) 🚧

- Mode A: one reactive DOM node per cell (max engine stress).
- Mode B: one `SubscriptionRef<Row>` per row → a reactive list of coalesced `<span>` runs.
- Mode C: one subscription per row → `innerHTML` string (browser-bound baseline).
- A runtime switch flips modes; changed-only rows update (unchanged rows keep node + subs).

### AC-INPUT — keystrokes to the terminal ✅

- Key events on the terminal call `session.write` with the encoded bytes (`encodeKey` maps
  Enter/Backspace/Tab/arrows/Ctrl-letters). Multi-pane focus routing lands with AC-MUX.

### AC-MUX — multiplexer chrome (`src/multiplexer.ts`) 🚧

- Split panes (`%` vertical, `"` horizontal), windows/tabs (`c`/`n`/`p`), status bar with a
  live clock, focus (`arrows`), kill pane (`x`), detach (`d`) via a `Ctrl-b` prefix state
  machine over a global `keydown` stream.
- Focused pane shown via a reactive border class; layout ratios bound reactively.

### AC-PERF — instrumentation (`src/perf.ts`) 🚧

- A visible FPS + updates/sec readout; a `flood` stress command; recorded ceilings per mode.

### AC-TEST 🚧 (unit + backend + hermetic browser done; mux assertions pending)

- Unit (`vp run test`): grid model ✅, ANSI parser ✅. Keybinding state machine lands with AC-MUX.
- Backend integration (Node `node --test`, `server/server.test.ts`): spawns a real PTY and
  round-trips a typed command over `ws` ✅.
- Browser e2e (`vp run test:browser`): mount `App` with `PtyTransportMockLive`; assert streamed
  output renders into the grid and a keystroke reaches the mock write log ✅. The `Ctrl-b %`
  two-pane assertion lands with AC-MUX. A live real-PTY browser run (real shell → `transport-ws`
  → reactive DOM) was validated manually; not kept in CI, since it needs the backend.

### Skips

- **type-tests: not applicable.** The example exposes no generic/type-level public API worth a
  TSTyche assertion; its contracts are runtime behaviours covered by unit + browser tests.

## Notes / accepted deviations

- Not single-command self-contained: a real run needs the `server/` PTY backend started
  separately (`node-pty` native addon). The mock transport keeps `app.ts` importable and the
  browser test hermetic. Accepted per the approved plan.
