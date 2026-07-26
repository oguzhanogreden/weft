# tmux in the browser

A tmux-style terminal multiplexer rendered with Weft, driven by a real shell over a
WebSocket-connected PTY. Split panes, windows, a status bar, and `Ctrl-b` keybindings, with
the terminal grid painted through Weft's reactive DOM.

## Overview

This example pushes Weft's reactive engine with the hardest workload a DOM UI library can
face: a live terminal. An 80x24 grid is about 2,000 cells; 200x50 is 10,000. A program like
`htop` repaints the whole grid 30 to 60 times a second. That is potentially hundreds of
thousands of cell updates per second, all flowing from an Effect `Stream` of PTY bytes into
reactive DOM.

## Problem

Most "does it scale" demos lean on a `<canvas>`. That hides the framework: the draw loop is
your own imperative code, and the reactive engine never runs on the hot path. Weft has no
canvas primitive, so a terminal is the honest stress test. The grid _is_ DOM, and every
repaint exercises the same subscription and reconciliation machinery a real app uses.

The catch: rendering a terminal as reactive DOM is exactly what naive frameworks fall over on.
That is the point. This example measures where Weft's model caps out instead of hiding it.

## Solution

Model PTY output as an Effect `Stream`, parse it with a pure VT state machine into an
immutable grid, and render the grid reactively. The real variable is not "per-cell vs per-row"
but _how many live reactive nodes and subscriptions update per frame_. The example exposes
three render modes and lets you switch between them at runtime:

- **Mode A** — one reactive DOM node per cell. Maximum engine stress.
- **Mode B** — one subscription per row driving a reactive list of coalesced `<span>` runs.
- **Mode C** — one subscription per row driving `innerHTML`. Browser-bound baseline where Weft
  is deliberately off the hot path, included so the comparison is honest.

An FPS and updates-per-second readout turns the demo into the repository's first benchmark. Grid
size is switchable at runtime too, so the same readout can be swept against cell count: 80x24 is
1,920 cells, 240x60 is 14,400. The grid opens fitted to your window, so pin a preset before
benchmarking, or you are measuring a size that depends on how wide the browser happens to be.

## How It Works

- **Transport as a service.** `PtyTransport` (`src/transport.ts`) is an Effect `Context.Service`.
  The app depends only on the interface. `PtyTransportWebSocketLive` wraps a browser
  `WebSocket` as a `Stream`; `PtyTransportMockLive` replays scripted bytes for tests. Sessions
  are `Scope`-bound, so unmounting a pane closes its socket and kills its shell.
- **Pure core.** `src/grid.ts` is the grid model with copy-on-write at row granularity: an
  untouched row keeps its exact array reference, which is how the renderer skips it.
  `src/ansi/parser.ts` is a chunk-safe VT parser (a sequence split across two PTY chunks parses
  identically to one whole string).
- **Reactive rendering.** Rows are keyed with `List.each`, so a full repaint only re-renders
  the rows whose references changed. Keystrokes flow back through `session.write`. Prefix
  keybindings ride a global `keydown` stream (`Stream.fromEventListener` + `Effect.forkScoped`),
  the same pattern as `examples/headless-menu`.
- **Backend.** `server/server.ts` spawns a `node-pty` shell per connection and bridges it to the
  socket. It is a standalone Node script, not part of the Vite build, because `node-pty` is a
  native addon.

## Running It

One command starts both the PTY backend and the dev server, and stops the backend on exit:

```bash
./examples/tmux/dev.sh      # → backend on :8787, dev server on http://localhost:5173/
```

It activates Node 26 (the repo pins `>=26.2.0 <27`), installs the backend's `node-pty` on first
run, fixes the `spawn-helper` execute bit, and tears the backend down when you Ctrl-C.

Prefer two terminals? Run them by hand (activate Node 26 in each first,
`export PATH="$HOME/.asdf/installs/nodejs/26.5.0/bin:$PATH"`):

```bash
# Terminal 1: PTY backend (first run: `npm install` here first)
cd examples/tmux/server && npm start   # ws://localhost:8787

# Terminal 2: dev server
cd examples/tmux && vp run dev          # http://localhost:5173/
```

The grid fits itself to the window and re-fits when you resize or rotate. Clicking a `size` preset
pins that size and stops the tracking; `auto` resumes it. Start at any size with
`?cols=200&rows=50`, which is the only way to choose a non-preset size deliberately (clamped to
400x200) and is itself a pin. A pinned size is written back to the URL, so a reload keeps it.

On a phone, tap the grid to bring up the keyboard. The accessory row above it supplies the keys a
soft keyboard lacks: Esc, Tab, arrows, and a sticky Ctrl (tap `ctrl`, then a letter, for Ctrl-C
and friends). The harness controls collapse behind `≡ controls` on narrow screens.

The browser test uses `PtyTransportMockLive` and needs no backend.

If a spawned shell fails with `posix_spawnp failed`, the `node-pty` prebuilt `spawn-helper`
lost its execute bit during install (some npm setups gate install scripts). `dev.sh` fixes this
automatically; by hand it is:

```bash
chmod +x examples/tmux/server/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
```

## When to Use

Reach for this example when you want to see Weft under sustained, high-frequency reactive load,
or to reason about the ceiling of per-node reactivity before building a data-dense UI (grids,
dashboards, editors). Flip the strategy and load levels and watch the FPS meter: the takeaway
for most apps is the `med` level, coalesce updates to the coarsest unit that still needs to
react rather than binding every cell.

## Status

Implemented and validated on Node 26:

- Pure core (`grid.ts`, `ansi/parser.ts`) with unit tests (`vp run test`).
- Transport service plus mock and WebSocket layers (`transport.ts`, `transport-mock.ts`,
  `transport-ws.ts`), and the `node-pty` backend.
- Single-terminal reactive rendering (`terminal.ts`, `app.ts`): per-row `SubscriptionRef`,
  keystroke input. Proven in Chromium via the mock transport (`vp run test:browser`).
- Real PTY over WebSocket, end to end: the backend integration test round-trips a real shell
  (`server/server.test.ts`), and a live browser run rendered real shell output through
  `transport-ws.ts`.
- Perf harness (`perf.ts`): live FPS and rows/sec meters, three render levels (low = 1 text
  node/row, med = 8, high = one coloured `<span>` per cell), and a synthetic load generator
  (off/low/med/high). Switch strategy against load to find where reactivity caps out. Covered
  by the browser test.
- Per-cell SGR colour at the `high` level (fg/bg/bold/italic/underline/inverse, 256-colour);
  `low`/`med` stay monochrome as the cheap node-count baselines.
- The app opens in the `high` (coloured) strategy, so real programs render in colour by default,
  including the reverse-video selection band as you move it through a menu. `low`/`med` are opt-in
  monochrome baselines you switch to from the control bar for benchmarking. 24-bit truecolor
  backgrounds are collapsed to the terminal default for now.
- Pixel-locked grid: one monospace cell is measured at runtime, then cell advance and row height
  snap to whole device pixels so glyphs render crisp. The lock applies to the grid container, so
  every render strategy inherits it. Covered by unit and browser tests.
- Scroll regions (DECSTBM `ESC[r`) and erase-character (`ESC[X`): the emulator scrolls inside a
  region and erases cell runs. So `tmux attach` renders without its status bar bleeding into the
  content. Covered by unit and browser tests.
- DEC line-drawing charset (`ESC(0` / `ESC(B`): `tmux` and `ncurses` select a graphics charset to
  draw pane borders, then send plain letters. Those letters now translate to box glyphs, so a
  border reads as `┌──┐` instead of `lqqk`. All 32 bytes of the table, covered by unit and
  browser tests.

- Grid size as a third harness axis: five preset buttons (80x24 through 240x60) switch the grid
  with no page reload, from 1,920 cells to 14,400. Each switch tears down the old row refs, pump,
  and per-cell subscriptions before building the new ones, and tells the shell via
  `session.resize` so it reflows. Covered by unit and browser tests.

Known defect: at the `high` strategy roughly 0.15% of cells render with an empty reactive region,
so a glyph goes missing and the rest of that row shifts one cell left. It predates the charset
work and is item 3 in `next-steps.md`. It scales with cell count, so it is far more visible at
the larger presets: roughly 3 cells at 80x24, roughly 22 at 240x60.

- Auto-fit: the grid derives its size from the viewport on load and on every debounced resize,
  clamped to the top preset so a large display cannot open on 26,000 cells. Pinning a preset stops
  the tracking; `auto` resumes it.
- Touch input: a hidden textarea summons the soft keyboard, an accessory row supplies Esc, Tab and
  arrows, and a sticky Ctrl makes `Ctrl-C` reachable. Printable characters arrive as `input`
  events, the path a phone takes when `keydown` reports `Unidentified`.

Not yet built: insert/delete line and mouse reporting, the remaining fidelity for full
`vim`/`tmux`-in-`tmux` rendering. The mobile path is browser-tested but not yet exercised on a
real handset. Note you run the real programs over the PTY, so there is no need for a Weft-native
multiplexer. See `next-steps.md` for the full roadmap.
