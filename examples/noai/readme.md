# noai: a streaming two-party transcript

Two model-backed agents talk to each other about an AI opt-out signal, and the browser
renders the whole exchange as it streams. A crawler agent fetches this example's own page.
A site agent speaks for that page. Two toggles filter the transcript by speaker.

## Overview

The `noai` signal has two halves that live in different places. One is an `X-Robots-Tag`
response header, invisible in the DOM. The other is a `<meta name="robots">` tag in the
document head.

This example emits both halves, then has an agent fetch the page and read them back. The
signal panel shows the received strings verbatim, next to the dialogue they produced.

`noai` and `noimageai` are a convention that originated outside the standards process. This
example emits and parses them. It makes no claim about what any party does with them. The
site agent puts it the way the code does: a request written where a crawler will see it, not
a mechanism that stops anything.

## Problem

A transcript is a harder reactive workload than it looks. Three things happen at once:

- **Nodes already on screen keep mutating.** Text appends token by token into a turn that is
  already mounted.
- **The node count grows without bound.** New turns append while old ones are still
  changing.
- **A filter re-derives what is visible.** Toggling a speaker must not disturb the turns that
  stay.

Doing any one of these is easy. Doing all three at once is where a naive renderer rebuilds
the list on every token, throwing away the DOM it just built.

`examples/tmux` stresses a different shape: a fixed grid, repainted whole. Here the list
grows while its existing members mutate.

## Solution

The filter **derives the visible list** rather than hiding nodes with CSS. A hidden
speaker's turns leave the keyed region entirely. That is the harder problem, and it forces
the question of where accumulated text lives.

The answer is that text lives in the transport, not the view. Each turn's text sits behind a
`Stream` that emits its current value on subscribe. A hidden speaker keeps accumulating off
screen, and re-enabling it renders the text that arrived while it was gone.

Both halves of the run are visible at once, which is the point. The server half is a header
you cannot see in the DOM. The client half is a tag in the head. The page shows what the
crawler actually received, so neither half has to be taken on trust.

## How It Works

- **Transport as a service.** `DialogueTransport` (`src/transport.ts`) is an Effect
  `Context.Service`. `App` depends only on the interface. `DialogueTransportLive` wraps a
  browser `WebSocket`; `makeScriptedTransport` replays a canned exchange. Sessions are
  `Scope`-bound, so unmounting closes the socket.
- **Frames in, accumulated state out.** The wire carries append-only deltas
  (`TurnStarted`, `TurnDelta`, `TurnCompleted`, `SignalObserved`, and the two terminal
  frames). Both transports fold them through the same `makeTranscript` accumulator, so the
  client cannot tell a scripted run from a live one. Only the banner differs.
- **Keyed rendering.** `List.each` keys turns by `turn.id`. A retained key keeps its DOM
  nodes and its running text subscription, so appending a turn never re-creates the ones
  above it. A key removed by a filter has its scope closed and its nodes destroyed, so
  re-showing it renders fresh from transport state.
- **Infallible streams, deliberately.** Every stream on `DialogueSession` has `E = never`. A
  failure arrives as data instead: the status goes to `failed` and an `error`-kind turn is
  appended. A failing stream would take the page down with it, which is the opposite of
  staying interactive.
- **Both agents run server side.** `server/agents.ts` drives two `claude-opus-5` streaming
  calls. The crawler gets one narrow tool that fetches this server's own route, so it cannot
  wander. It is not told what the signal says. It fetches, reads, and reports.
- **The signal is assembled in one place.** `renderPage` (`server/server.ts`) applies all
  three pieces: the header, the `robots` meta tag, and the tag naming the transport. That
  assembly was once split across a helper and its untested caller, which let the same
  injection bug ship twice. It now lives where a test can reach it.

A node test walks the value-import graph from `src/main.ts`. Nothing reachable from the
client entry may import anything under `server/`, and `@anthropic-ai/sdk` is one instance of
that rule. Type-only imports are erased under `verbatimModuleSyntax`, so they do not count.

## Running It

One command serves the page and the dialogue socket from the same origin, which is what lets
the crawler's tool fetch the server that runs it:

```bash
vp run -F noai dev      # → http://127.0.0.1:3300
```

With no credential in the environment the run is **scripted**, and a banner says so. The
page works in full: transcript, streaming, toggles, and signal panel all behave the same.

For a live run, set the key before starting:

```bash
ANTHROPIC_API_KEY=sk-ant-... vp run -F noai dev
```

Mode detection reads `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` only. An `ant auth login`
profile alone leaves the run scripted, even though the SDK could resolve it. No credential is
ever written into a file in this repo.

The dialogue socket accepts an upgrade only from this server's own origin. A WebSocket
handshake is not subject to CORS. Without that check, any page open in the same browser could
connect on loopback and drive billed calls.

The browser test mounts `App` against the scripted transport and needs no server:

```bash
vp run test:browser
```

That task runs every example's browser tests, not just this one. At the time of writing four
`examples/tmux` tests fail on `main`, unrelated to this example. Look for
`examples/noai/src/app.browser.test.ts` in the per-file list.

## When to Use

Reach for this example when you are building a view whose list grows while its existing
members keep changing. Chat transcripts, log tails, streamed agent output, and live feeds all
share that shape.

The transferable pattern is where accumulated state lives. Put it in the transport, behind a
stream that replays on subscribe, and the view is free to throw work away. It can drop a node
and rebuild it later without losing anything, because it was never the source of truth.

Read `src/specs.md` for the acceptance criteria, the `List.each` reconciliation guarantees
the toggles rest on, and the decisions recorded against each.
