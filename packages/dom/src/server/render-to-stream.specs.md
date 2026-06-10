# renderToStream — Specification

## Overview

`renderToStream` progressively serializes an Effect-infused JSX tree (`Renderable`)
into a `Stream.Stream<string, Error>` of HTML chunks, emitted in render-tree
order. It is the streaming counterpart of `renderToString` and, inspired by
React's Fizz (`renderToPipeableStream`), interleaves work and flush: chunks
produced before a slow `Stream`/`Effect` node reach the consumer while that node
is still resolving. Effect's pull-based streams supply backpressure.

`renderToString` is re-derived from `renderToStream` via `Stream.mkString` (the
string-accumulating destination), so the two share serialization semantics.

## Design notes (divergence from React)

- **Shell-only.** Reactive (`Stream`/`Effect`) values are collapsed to their
  **first/current** emission (via `Stream.runHead`) before the corresponding
  chunk is emitted. This matches the client's initial paint and lets
  non-terminating streams (e.g. `SubscriptionRef.changes`) resolve immediately
  instead of hanging. There is no Suspense, no fallback inlining, and no
  late-reveal `<template>`/`$RC` protocol.
- **Reactive attribute values, no prop renaming, minimal boolean handling.** Same
  as `renderToString` — see `render-to-string.specs.md`; these come from the
  shared serialization helpers in `serialize.ts`.
- **Function components.** A function-component node is invoked once with its
  `props` (passed verbatim from the node — no defaultProps or extra children
  injection beyond what h runtime already set), and its returned `Node` is
  rendered recursively. Mirrors the client renderer's `renderComponent`
  (`render-core.ts`). There is no per-render state or lifecycle on the server.

## Acceptance criteria

### Serialization (shared with renderToString)

- AC-EQ1: For any node, `Stream.mkString(renderToStream(node))` equals
  `renderToString(node)`. All serialization ACs (text/elements/attributes/style/
  reactive attributes/void elements) from `render-to-string.specs.md` therefore
  hold for the concatenated stream output.

### Streaming behavior

- AC-ST1: Chunks are emitted in render-tree (document) order.
- AC-ST2: A `null`/`undefined`/`boolean` node and an empty reactive node
  contribute no chunks (`Stream.empty`).
- AC-ST3: **Progressive flush.** Chunks for nodes that precede a delayed
  `Effect`/`Stream` node are emitted before that node resolves.
- AC-ST4: An unsupported node type (a `type` that is neither a string, the
  `FRAGMENT` symbol, nor a function — e.g. a number) fails the stream with an
  `Error` (parity with `renderToString`).

### Function components

- AC-FC1: A function-component node (`{ type: (props) => Renderable, props }`) calls
  the component once with `props` and renders its returned `Renderable` recursively.
- AC-FC2: A component returning an element/fragment/iterable/primitive renders
  identically to that node written inline.
- AC-FC3: A component returning a `Stream`/`Effect` is rendered via the reactive
  branch — collapsed to its first/current emission, and (in the hydratable
  variant) wrapped in `<!-- stream-start-N -->` … `<!-- stream-end-N -->` markers.
- AC-FC4: Components nest — a component whose result contains further components
  renders fully.
- AC-ST5: A large tree with multiple async branches resolving on staggered delays
  serializes in **document order** (not completion order), and chunks observed via
  `Stream.tap` accumulate to exactly the final `Stream.mkString` output.
- AC-ST6: A non-terminating reactive node (e.g. `SubscriptionRef.changes`) is
  collapsed to its current value and the stream completes — SSR does not hang.

## Suspense streaming & shell split (cross-reference)

Suspense streaming behaviour (fallbacks, markers, patches) is specified in
`suspense-ssr.specs.md`; the shell-split API (`renderToHydratableShell`) and the
Suspense late-failure handler seam (`SuspenseFailureHandlerTag`) are specified
in `streaming-shell.specs.md`. The combined-stream variants specified here are
**unchanged** by the shell split and remain the equivalence baseline
(`streaming-shell.specs.md` AC-SH1).

Two behaviours of the combined streams, previously implicit, are pinned here:

- AC-ST7: **Patches strictly follow the main walk.** Both variants are
  structurally `Stream.concat(mainStream, patchStream)`: no Suspense patch
  chunk is ever emitted before the main document walk has completed, regardless
  of how quickly a boundary's children resolve. (`Boundary.rpc` is resolved
  inline, blocking the walk — it never patches.)
- AC-ST8: **Suspense resolution failures are swallowed by default.** A cause
  raised inside `Boundary.suspend` children that no failure `Boundary` in those
  children handles does not fail the stream: no patch is emitted for that
  boundary, its fallback persists, and the patch stream still terminates once
  remaining boundaries settle. This default is extensible via the optional
  `SuspenseFailureHandlerTag` seam (`streaming-shell.specs.md` AC-FH1–AC-FH6),
  which may substitute patch content for such causes.
