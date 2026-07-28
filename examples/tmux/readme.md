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

## Remote Access

The example can run on one machine and be driven from another, over Tailscale. Your laptop
becomes a small terminal server your phone can reach.

Point `tailscale serve` at both processes, mapping them onto one HTTPS origin:

```bash
tailscale serve --bg --set-path /    http://127.0.0.1:5173
tailscale serve --bg --set-path /pty http://127.0.0.1:8787
```

Open the resulting `https://<machine>.<tailnet>.ts.net/` from any device on your tailnet. The app
derives its WebSocket URL from the page itself (`wss://`, same host, path `/pty`), so nothing needs
configuring on the client. Run `tailscale serve status` to see or undo the mapping.

Two environment variables control what a remote connection can do:

- `PTY_TOKEN=<secret>` requires `?token=<secret>` on every connection. Bookmark the URL with the
  token included. A wrong or missing token closes with code 1008, and the control bar's status dot
  shows `unauthorized`. Unset by default, so local dev needs nothing.
- `TMUX_SESSION=<name>` spawns `tmux new -A -s <name>` instead of a plain shell. A dropped
  connection reconnects into the same session rather than a fresh one, so a phone going to sleep
  costs you nothing.

The backend always binds `127.0.0.1`, never a public interface. `tailscale serve` is what makes it
reachable, and only to your tailnet. `tailscale funnel` is a different command: it publishes to the
public internet. Don't run it against this backend unless `PTY_TOKEN` is set.

A dropped connection retries automatically with backoff, and the status dot shows `connecting`,
`live`, `offline`, or `unauthorized`. `offline` means retries paused after about two minutes; they
resume as soon as the page becomes visible again (your phone waking up) or every 30 seconds either
way, whichever comes first. `unauthorized` means the token was wrong, so retrying will not help.

## Sharing a Read-Only View

Beyond driving the shell yourself from another device, you can let other people watch it live,
without giving them the ability to type. tmux already does the hard part: `attach-session -r` is
a read-only attach, and a read-only client's own window size never resizes the shared session.

Set a second token, distinct from `PTY_TOKEN`, alongside `TMUX_SESSION` (a read-only attach needs
a named session to attach to):

```bash
PTY_VIEW_TOKEN=<a-different-secret> TMUX_SESSION=<name> ./examples/tmux/dev.sh
```

Connect as the presenter (with `PTY_TOKEN`, or with no token if you have not set one) and the
control bar shows a `share` button. Click it to copy a viewer link to your clipboard:
`https://<host>/?token=<view-token>&role=viewer`. Send that link to anyone on your tailnet.

A viewer's screen is deliberately minimal: the terminal grid and a connection-status dot, no
control bar, no perf harness. They cannot type into the shell, full stop, not because the control
bar is hidden but because the connection itself attaches read-only. Which role a connection gets
is decided purely by which token it presents, `PTY_TOKEN` or `PTY_VIEW_TOKEN`, never by anything
the page itself asserts.

Without `TMUX_SESSION` set, a `PTY_VIEW_TOKEN` connection is rejected the same way a wrong
`PTY_TOKEN` is: there is no named session for a read-only attach to join.

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
- Per-cell SGR colour at the `high` level (fg/bg/bold/italic/underline/inverse, 256-colour and
  24-bit truecolor); `low`/`med` stay monochrome as the cheap node-count baselines.
- The app opens in the `high` (coloured) strategy, so real programs render in colour by default,
  including the reverse-video selection band as you move it through a menu. `low`/`med` are opt-in
  monochrome baselines you switch to from the control bar for benchmarking.
- Both truecolor syntax forms parse: `38;2;r;g;b` and tmux's `38:2::r:g:b`. The backend advertises
  `COLORTERM=truecolor` to the spawned shell. tmux itself still needs its own config to pass RGB
  through: `set -as terminal-features ',xterm-256color:RGB'` (tmux ≥ 3.2), or
  `set -ga terminal-overrides ',xterm-256color:Tc'` on older tmux.
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

- Cell integrity: every cell renders a character, blanks included. Roughly 0.15% used to come out
  empty, dropping a glyph and shifting the rest of the row one cell left, and it got worse with
  grid size. The cause was in `@weftui/dom` rather than this example: a reactive child's first
  emission was silently discarded if it arrived before its comment markers were attached, which
  left that region permanently empty. Fixed there, guarded by tests in both packages.
- Auto-fit: the grid derives its size from the viewport on load and on every debounced resize,
  clamped to the top preset so a large display cannot open on 26,000 cells. Pinning a preset stops
  the tracking; `auto` resumes it.
- Touch input: a hidden textarea summons the soft keyboard, an accessory row supplies Esc, Tab and
  arrows, and a sticky Ctrl makes `Ctrl-C` reachable. Printable characters arrive as `input`
  events, the path a phone takes when `keydown` reports `Unidentified`.

- Remote access: a running instance is reachable from another device over Tailscale, one HTTPS
  origin proxied to both processes. The backend binds loopback only; an optional `PTY_TOKEN` gates
  the shell, and `TMUX_SESSION` makes a dropped connection reconnect into the same session instead
  of a fresh one. A dropped connection retries automatically with backoff, shown as a status dot in
  the control bar; a rejected token is a distinct, non-retrying state. See "Remote Access" above.
- Read-only multi-viewer access: a second token (`PTY_VIEW_TOKEN`) grants a read-only `tmux
attach -r` instead of the read-write shell, built on tmux's own multi-client support rather than
  a bespoke broadcast layer. The presenter's control bar can share a viewer link directly; a
  viewer's screen is the grid and a status dot, nothing else. See "Sharing a Read-Only View" above.

Not yet built: insert/delete line and mouse reporting, the remaining fidelity for full
`vim`/`tmux`-in-`tmux` rendering. The mobile path and remote access are both browser- and
backend-tested but not yet exercised together on a real handset over a real tailnet, now the
practical way to do that verification. Note you run the real programs over the PTY, so there is no
need for a Weft-native multiplexer. See `next-steps.md` for the full roadmap.
