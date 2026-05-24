# ssr-hydration

A minimal, live server-side-rendering + client-hydration demo for `@effect-ui/dom`.

## Overview

A Node dev server renders `<App/>` to **hydratable** HTML on every request. The
browser receives that server markup, then the client `hydrate()`s it: the static
structure is adopted in place and the reactive counter region resumes
flash-free, becoming interactive without re-rendering.

## How to run

```bash
vp run -F ssr-hydration dev
```

Then open <http://localhost:3100>.

## How it works

- **Server** (`server.ts` → `src/entry-server.tsx`): `renderToStringHydratable(<App/>)`
  produces HTML that includes `<!-- stream-start-N -->` / `<!-- stream-end-N -->`
  comment markers around the reactive `{count.changes}` region. The server renders
  the stream's first emission — `0` — between those markers.
- **Client** (`src/entry-client.tsx`): `hydrate(<App/>, #root)` walks the JSX tree
  in lockstep with the existing DOM, adopting nodes in place and attaching event
  handlers. It locates the reactive region via the markers and hydrates the
  stream's first emission (`0`) against the adopted node. Because server and client
  first emissions match, the node keeps its identity — no flash, no re-mount.

## What to observe

- `curl -s http://localhost:3100` shows the static content plus the
  `<!-- stream-start-` / `<!-- stream-end-` markers wrapping the count `0` —
  proving hydratable HTML is produced before any JS runs.
- In the browser, the counter shows `0` immediately (server markup). After
  hydration the `+` / `-` buttons work, the status flips to `[hydrated]`, and the
  count node does not flicker on the first emission.
