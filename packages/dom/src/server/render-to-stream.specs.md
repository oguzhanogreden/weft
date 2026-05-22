# renderToStream — Specification

## Overview

`renderToStream` progressively serializes an Effect-infused JSX tree (`JSXNode`)
into a `Stream.Stream<string, Error>` of HTML chunks, emitted in render-tree
order. It is the streaming counterpart of `renderToString` and, inspired by
React's Fizz (`renderToPipeableStream`), interleaves work and flush: chunks
produced before a slow `Stream`/`Effect` node reach the consumer while that node
is still resolving. Effect's pull-based streams supply backpressure.

`renderToString` is re-derived from `renderToStream` via `Stream.mkString` (the
string-accumulating destination), so the two share serialization semantics.

## Design notes (divergence from React)

- **Shell-only.** Reactive (`Stream`/`Effect`) values are collapsed to their
  **last** emission (via `Stream.runLast`) before the corresponding chunk is
  emitted. There is no Suspense, no fallback inlining, and no late-reveal
  `<template>`/`$RC` protocol.
- **Reactive attribute values, no prop renaming, minimal boolean handling.** Same
  as `renderToString` — see `render-to-string.specs.md`; these come from the
  shared serialization helpers in `serialize.ts`.

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
- AC-ST4: An unsupported node type fails the stream with an `Error` (parity with
  `renderToString`). Function-component `type` is out of scope and falls through
  to this failure.
- AC-ST5: A large tree with multiple async branches resolving on staggered delays
  serializes in **document order** (not completion order), and chunks observed via
  `Stream.tap` accumulate to exactly the final `Stream.mkString` output.
