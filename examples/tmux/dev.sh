#!/usr/bin/env bash
# One-call local dev for the tmux example.
#
# Starts the PTY backend and the Vite dev server together, and tears the backend
# down when you exit (Ctrl-C). Handles Node 26 activation and first-run backend
# install. Run from anywhere:
#
#   ./examples/tmux/dev.sh        (or:  bash examples/tmux/dev.sh)
#
# PTY_TOKEN and TMUX_SESSION, if already exported, pass straight through to the
# backend (see readme.md, "Remote Access"). Neither is required for local dev.
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
port="${PORT:-8787}"

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }

# --- Ensure Node >= 26 (repo pins >=26.2.0 <27 with engine-strict) ---
if [ "$(node_major)" -lt 26 ]; then
	asdf26="$(ls -d "$HOME"/.asdf/installs/nodejs/26.* 2>/dev/null | sort -V | tail -1 || true)"
	[ -n "${asdf26:-}" ] && export PATH="$asdf26/bin:$PATH"
fi
if [ "$(node_major)" -lt 26 ]; then
	echo "Node >= 26 required (found: $(node -v 2>/dev/null || echo none))." >&2
	echo "Install it, e.g.: asdf install nodejs 26.5.0" >&2
	exit 1
fi
echo "→ Node $(node -v)"

# --- Resolve the vp CLI ---
if command -v vp >/dev/null 2>&1; then
	vp_cmd=(vp)
elif [ -x "$repo_root/node_modules/.bin/vp" ]; then
	vp_cmd=("$repo_root/node_modules/.bin/vp")
else
	vp_cmd=(pnpm exec vp)
fi

# --- First-run backend setup (node-pty native addon) ---
if [ ! -d "$here/server/node_modules/node-pty" ]; then
	echo "→ Installing backend deps (node-pty)…"
	npm install --prefix "$here/server"
fi
# The prebuilt spawn-helper can lose its execute bit under gated installs.
helper="$here/server/node_modules/node-pty/prebuilds/$(node -p 'process.platform + "-" + process.arch')/spawn-helper"
[ -f "$helper" ] && chmod +x "$helper" 2>/dev/null || true

# --- Start the PTY backend; kill it on exit ---
echo "→ Starting PTY backend on ws://localhost:$port …"
PORT="$port" node --experimental-strip-types "$here/server/server.ts" &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM
sleep 1

# --- Dev server in the foreground (Ctrl-C stops everything) ---
echo "→ Starting dev server (http://localhost:5173/) …"
cd "$here"
"${vp_cmd[@]}" run dev
