# noai: a transparent dialogue about an opt-out signal

## Overview & Purpose

Two model-backed agents talk to each other about whether one of them may ingest the
other's content. A **crawler** agent fetches this example's own page. A **site** agent
speaks for the page and declares an AI opt-out. The browser renders the whole exchange
as it streams, and you can toggle either speaker off to read one side alone.

The example exists for two reasons.

First, it is Weft's stress test for a **streaming two-party transcript**. Turns arrive
token by token from two independent sources over one WebSocket. Text appends inside a
turn that is already mounted, new turns append to a keyed list, and two filter toggles
re-derive what is visible without remounting what stays. That is a different shape from
`examples/tmux`, which repaints a fixed grid: here the node count grows without bound
while nodes already on screen keep mutating.

Second, the `noai` signal only makes sense when you can see both halves at once. The
server half is an `X-Robots-Tag` response header, invisible in the DOM. The client half
is a `<meta name="robots">` tag in the document. Neither half tells the whole story, so
the page shows the real bytes the crawler received next to the dialogue it produced.

The crawler does not have the signal described to it. It fetches, reads, and reports.

## Acceptance Criteria

### The signal

Both header and meta tag are produced by the server's HTML assembly, so both are
**server-test scope**. A browser-mode mount has no `<head>` from `index.html`, so
`/e2e` must not try to assert either one from the mounted tree.

- [ ] **AC-SIGNAL-HEADER**: The SSR route responds with `X-Robots-Tag: noai, noimageai`.
- [ ] **AC-SIGNAL-META**: The served document contains
      `<meta name="robots" content="noai, noimageai">` inside `<head>`, exactly once.
      `index.html` already carries the tag, so the **primary** test case is the
      idempotence path: a template that already has the tag yields exactly one tag, not
      two. That is the path production takes on every request. Injection into a
      tag-less template is the secondary case.
- [ ] **AC-SIGNAL-PANEL**: The client renders the status line, the `X-Robots-Tag` value,
      and the `<meta>` tag exactly as the crawler received them. No re-serialization, no
      pretty-printing: the panel shows the received strings. This one _is_ browser scope:
      the values arrive as turn-event data, not from the document.

### The dialogue

- [ ] **AC-FETCH**: The crawler agent is given one tool that performs a real HTTP request
      to this example's own SSR route. The tool result carries status, response headers,
      and any `robots` meta tag found in the body.
- [ ] **AC-TURNS**: Every turn from either agent reaches the browser over one WebSocket
      and renders in arrival order, labelled with its speaker.
- [ ] **AC-STREAM**: Text renders incrementally while a turn is still generating. A turn
      that is mid-stream is visibly present and growing, not withheld until complete.
      **Testability requirement**: the scripted transport must emit deltas one at a time
      with awaitable gaps between them. A scripted turn that resolves as one whole string
      makes this criterion unobservable, and the browser test would silently assert final
      state instead.
- [ ] **AC-TOOL-TURN**: The crawler's fetch call and its result appear in the transcript
      as their own turns, attributed to the crawler. The dialogue does not silently jump
      from question to conclusion.
- [ ] **AC-ORDER**: A turn already on screen is never re-created when a later turn
      arrives. Appending to the transcript mutates only the tail. **Testability
      requirement**: this needs an observable handle, a stable element reference captured
      from an earlier tick and compared by identity after a later turn arrives. The
      mounted tree appears a tick after `mount` resolves, so the comparison runs under
      `vi.waitFor`, never as a synchronous read.

### The toggles

**Render strategy, decided here because it is load-bearing.** A filter _derives the
visible list_: a hidden speaker's turns are removed from the reactive list, not merely
hidden with CSS. This is the harder reactive problem and the one that distinguishes this
example from `examples/tmux`. It also fixes what the criteria below can mean.

**What `List.each` guarantees, checked against `packages/dom/src/client/list.specs.md`.**
This decides whether the criteria below are satisfiable at all, so it is recorded rather
than assumed:

- **KR3, retained key**: scope stays open, subscription fibers keep running, DOM nodes are
  reused. Only position may change. This is what makes AC-FILTER's surviving element
  references true for the speaker that stays visible.
- **KR4, removed key**: scope is closed, fibers are interrupted, DOM nodes are removed. A
  re-added key therefore runs `render` again and gets **new** nodes and a **new**
  subscription.

The consequence matters for tests: do **not** assert that a turn hidden and then re-shown
keeps its original element reference. KR4 makes that false. AC-FILTER-LIVE is still
satisfiable, but for a different reason. Accumulated text lives in the transport, so the
fresh subscription replays the current value on subscribe and the turn renders complete.
Text survives a toggle; element identity does not.

- [ ] **AC-FILTER**: Two toggles, one per agent, both on at start. Turning one off removes
      that agent's turns from the rendered list. The other agent's turn nodes are not
      re-created: the same element references survive the toggle.
- [ ] **AC-FILTER-EMPTY**: With both toggles off the derived list is empty and the
      transcript shows an empty-state message, not a blank region.
- [ ] **AC-FILTER-LIVE**: Toggling never interrupts the stream. Turns for a hidden speaker
      keep arriving and their text keeps accumulating in **transport state**, which is the
      source of truth and is independent of what is mounted. Re-enabling renders those
      turns from accumulated state, including text that arrived while hidden.

### Running with and without a key

- [ ] **AC-SCRIPTED**: With no API credential available the example runs a scripted
      transport. The page works in full: transcript, streaming, toggles, signal panel. A
      banner states that the run is scripted.
- [ ] **AC-LIVE**: With a credential available both agents are driven by real
      `claude-opus-5` streaming calls, and the banner is absent.
- [ ] **AC-NO-KEY-IN-CLIENT**: No credential ever reaches the browser bundle. Both model
      calls are made server side. **Verification**: this is a negative invariant, so no
      signature can express it and no mounted assertion can catch it. A node test asserts
      that nothing reachable from `src/` imports `@anthropic-ai/sdk`, walking the import
      graph from `src/main.ts`. Surfaced at `/mock`, where the checklist found the
      criterion had no home in the API surface.
- [ ] **AC-REFUSAL**: A response carrying `stop_reason: "refusal"` renders as a visible
      turn stating that the model declined. It is not dropped, and it does not throw.
- [ ] **AC-TRANSPORT-ERROR**: A dropped WebSocket or a failed model call renders as a
      terminal transcript entry. The page stays interactive and the toggles keep working.
- [ ] **AC-SOCKET-ORIGIN**: The dialogue socket accepts an upgrade only from this
      server's own origin. A request carrying any other `Origin` is refused before a
      dialogue starts. A request carrying no `Origin` is allowed, since non-browser
      clients send none and they are not the risk.

**AC-SOCKET-ORIGIN was added at `/review-step`**, through the pause rule rather than with
the original spec.

A WebSocket handshake is not subject to CORS. Without this check, any page open in the
developer's browser can connect to loopback and start a dialogue. On a live run each
connection makes billed `claude-opus-5` calls, so the check is a cost control rather than
a formality.

`examples/tmux` has the same missing check and is unaffected: it drives a PTY, which costs
nothing per connection.

This adds one export, `isAllowedOrigin` in `server/server.ts`, so the predicate can be
pinned by a node test without booting Vite and a listener.

### Head injection is shared, after the same bug appeared twice

`injectRobotsMeta` used a literal `replace("<head>", …)`, which silently returns the
document unchanged for `<head lang="en">` or a headless template. Fixed at `/review-step`
by matching `<head>` as a tag.

The re-review then found the identical pattern one call site over, in `servePage`, where it
writes the `noai-dialogue-mode` meta tag. That one fails worse. `chosenTransport` in
`src/main.ts` treats a missing mode tag as **live**, so a keyless dev server would tell the
client to open a real socket and drive real model calls, which is the exact fallback
AC-SCRIPTED exists to provide. Both call sites now go through one exported helper,
`injectIntoHead` in `server/signal.ts`, so the fix cannot be applied to one and missed at
the other. That is the second added export, on the same pause-rule grounds as
`isAllowedOrigin`.

A third pass then asked why the bug could hide there at all. The answer: `servePage`
assembled part of the page itself, and `servePage` is not exported and has no test, so the
composed document was never asserted. `renderPage` now takes the mode and applies all three
pieces, and `servePage` only serves what it returns. That changes `renderPage`'s signature
from `(template)` to `(template, mode)`, the third and last surface change made under the
pause rule.

The rule this encodes: **assembly belongs where it can be tested.** Splitting it across an
exported function and its untested caller is what let the same defect ship twice.

### Tests

- [ ] **AC-E2E**: A co-located `*.browser.test.ts` imports `App`, mounts it in a real
      browser against the scripted transport, and asserts the headline behaviour: turns
      from both speakers appear, and each toggle filters its own speaker.
- [ ] **AC-SERVER-TEST**: Node `*.test.ts` files assert `AC-SIGNAL-HEADER`,
      `AC-SIGNAL-META`, and the fetch tool's parsing of status, headers, and meta tag.
      Co-located per module rather than in one file: `server/signal.test.ts` pins the two
      halves of the signal and the fetch tool's parsing, `server/server.test.ts` pins that
      the assembled route actually applies both. They must be reported by `vp run test`,
      which requires the wiring in _Test wiring_ below.

## Technical Requirements

### Layout

**One workspace package.** This deliberately does _not_ copy `examples/tmux`'s
`server/` subpackage. That subpackage exists because `node-pty` is a native addon, so it
is kept out of the workspace, excluded from `fmt` and `lint` in the root
`vite.config.ts`, and its test runs via a bare `node --test`, not via `vp run test`.
`@anthropic-ai/sdk` is an ordinary package and needs none of that. Keeping one workspace
package means the server code is linted, formatted, and type-checked with everything
else.

Keeping the SDK out of the client bundle needs no subpackage: Vite includes only what
`index.html` reaches through `main.ts`. Server-only modules are never imported from the
client entry, so they never enter the bundle. This is how `examples/router-ssr` works.

**The page is client-rendered, not server-rendered.** `renderPage` takes a template and
applies the two signal halves; it has no `DialogueTransport` to provide, so it cannot
render `App`. Nothing here needs it: no acceptance criterion asserts server-rendered
markup, and the crawler reads the headers and `<head>`, both of which the template
carries. The route is still called the SSR route in AC-SIGNAL-HEADER, where it means the
server-served HTML route.

The server also writes a `<meta name="noai-dialogue-mode">` tag naming which transport the
client should use, because only the server can see whether a credential resolved. Its name
is a module-local constant in both `server/server.ts` and `src/main.ts` rather than a
shared export, so the approved API surface stays as approved.

```
examples/noai/
  index.html                 references src/main.ts
  package.json               workspace member; @anthropic-ai/sdk lives here
  tsconfig.json
  vite.config.ts             WS proxy for /dialogue; test.include covers server/
  readme.md
  server/server.ts           node HTTP + Vite middleware, page assembly, noai headers
  server/main.ts             thin entry: runs `main()`, referenced by the dev task
  server/signal.ts           emitting and reading both halves of the signal
  server/agents.ts           both agent loops, model calls, fetch tool
  src/app.ts                 exports App, side-effect free
  src/main.ts                mounts App, referenced by index.html
  src/transport.ts           transport interface + turn event union
  src/transport-live.ts      real WebSocket
  src/transport-scripted.ts  canned exchange with awaitable delta gaps (see AC-STREAM)
  src/specs.md               this file
```

Tests, co-located per module:

```
  server/signal.test.ts            AC-SIGNAL-HEADER, AC-SIGNAL-META, AC-FETCH parsing
  server/server.test.ts            the assembled route applies both halves
  server/agents.test.ts            model config, crawler prompt, exhausted-budget path
  src/transport.test.ts            frame decoding + transcript accumulation
  src/transport-scripted.test.ts   AC-SCRIPTED, AC-STREAM delta gaps
  src/transport-live.test.ts       URL derivation
  src/app.test.ts                  AC-FILTER semantics, DOM-free
  src/no-server-in-bundle.test.ts  AC-NO-KEY-IN-CLIENT, static import-graph walk
  src/app.browser.test.ts          AC-E2E, and every other browser-scope criterion
```

### What the browser test covers, and why it exceeds AC-E2E

AC-E2E names one headline behaviour. The browser file covers more than that, because
several other criteria are browser-scope by their own wording and `src/app.test.ts`
explicitly defers their rendered consequences here: AC-STREAM and AC-ORDER (both carry a
_Testability requirement_ pointing at a real browser), AC-FILTER's surviving element
references, AC-FILTER-EMPTY, AC-FILTER-LIVE, AC-SIGNAL-PANEL, and the client-visible
halves of AC-SCRIPTED, AC-LIVE, AC-REFUSAL, and AC-TRANSPORT-ERROR.

Two replay speeds, because they answer different questions. Settled-state tests run at
`"0 millis"`, which still yields between deltas but leaves no timing window. Mid-stream
tests use a wide interval and a script long enough that the turn cannot drain between
observing its first delta and pausing the replay.

The deterministic mid-stream foothold is a property of the scripted transport worth
naming: it applies `TurnStarted` **above** its pause gate, so a handle paused before
`connect` yields a started turn with empty text and `data-complete="false"`. That is a
frozen state with no race, and it is where the AC-STREAM and AC-ORDER tests begin.

**AC-STREAM's testability requirement is enforced, not just documented.** Collapsing the
mid-stream script to a single chunk (a turn that "resolves as one whole string", the exact
regression the criterion warns about) fails two tests. Verified by probe, not by reading.

Not asserted here, deliberately:

- **AC-SIGNAL-HEADER / AC-SIGNAL-META.** A browser-mode mount has no `<head>` from
  `index.html` and no response headers. Both are asserted in `server/`.
- **Element identity across a hide-then-reshow.** KR4 closed the removed key's scope, so
  those are new nodes. Text survives a toggle; identity does not. Asserting identity there
  would encode the opposite of what `list.specs.md` guarantees.
- **The served mount path**, meaning `main.ts` reading the mode meta tag through
  `chosenTransport` and mounting against it. The browser test constructs its own scripted
  transport and mounts `App` directly, which is what keeps it dev-server-free. Nothing
  automated therefore covers the path a person takes at `http://127.0.0.1:3300`, and
  `start` reports a mount failure to `console.error` rather than to a test. This is the
  structural cost of the side-effect-free `app.ts` split, not an oversight. Verified by hand
  at `/document` against a running server: the page mounts, both speakers stream, the signal
  panel shows the received strings, and hiding the crawler drops the transcript from 7 turns
  to 2 with no console errors.

### Test wiring

`vp run test` will not pick up `server/server.test.ts` for free. Two things are required
and are part of this example's scope:

- Add `examples/noai` to `test.projects` in the root `vite.config.ts`.
- Set this package's `test.include` to cover both `src/**/*.test.{ts,tsx}` and
  `server/**/*.test.ts`, excluding `*.browser.test.*` as the other examples do.

Confirm at `/implement` that `vp run test` actually reports the server test, rather than
assuming the config is right.

### Model calls

- Model `claude-opus-5`, via `@anthropic-ai/sdk`, streaming (`client.messages.stream`).
- Streaming is required, not an optimization: the transcript is the point, and a large
  `max_tokens` on a non-streaming call risks an HTTP timeout.
- Adaptive thinking is on by default on this model, and is left at that default. **A
  second correction found at `/implement`**: an earlier draft required
  `thinking: { type: "adaptive", display: "summarized" }`. The pinned
  `@anthropic-ai/sdk@0.70.1` types `ThinkingConfigParam` as `Enabled | Disabled` only,
  with no `adaptive` variant anywhere, and `Enabled` requires the `budget_tokens` this
  model rejects with a 400. Omitting the parameter is therefore both the correct
  behaviour and the only expressible one. Revisit if the SDK floor moves.
- A refusal is a normal 200 response, so `stop_reason` is checked before `content` is read.
  Verified against the installed SDK: `StopReason` includes `"refusal"`, and a streamed
  response carrying it resolves normally rather than throwing.
- **Correction, found at `/unit-test`.** An earlier draft of this section required opting
  into server-side refusal fallbacks (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`). The pinned `@anthropic-ai/sdk@0.70.1` has no
  `fallbacks` parameter anywhere in its types, so that is not expressible as a typed
  option here. Dropped rather than smuggled in as an untyped extra body field. Revisit if
  the SDK floor moves.
- The credential is resolved by the SDK from the environment or from an `ant auth login`
  profile. It is never written into a file in this repo.
- **Detection is narrower than resolution, and the gap is user-visible.** `hasCredential`
  reads `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` and nothing else, while the SDK would
  also resolve an `ant auth login` profile. A developer holding only a profile therefore gets
  a scripted run whose banner says no credential resolved, when a live call would have
  succeeded. Recorded at `/document` rather than changed: making detection match resolution
  means asking the SDK to resolve before choosing the mode, which is a behavior change rather
  than a doc fix. The readme names the environment variable instead of saying "a credential".
- `DialogueOptions.baseUrl` overrides the SDK's base URL. It exists as a **test seam**:
  without it, `AgentError` and `AgentRefusal` are unreachable without a real credential,
  so the refusal path would have no automated coverage. The consequence for the
  implementation is that the client is constructed per call, not once at module scope, or
  the override arrives too late to take effect.

### Transport

One interface with two implementations, chosen at runtime by whether a credential is
available. Tests always take the scripted one, which makes `AC-E2E` deterministic and
keyless. This mirrors `transport-mock.ts` / `transport-ws.ts` in `examples/tmux`.

## Dependencies & Integrations

- `@weftui/core`, `@weftui/dom` as `workspace:*`.
- `effect` from the catalog. PTY-free: the only external I/O is the model call and the
  crawler's self-fetch.
- `@anthropic-ai/sdk` as a dependency of this package, imported only from `server/`, so
  it never reaches the client bundle.
- `ws` for the WebSocket server, matching `examples/tmux`.
- Validated through `vp run check`, `vp run test`, and `vp run test:browser`.

## Expected Behavior & Edge Cases

- **Self-fetch loop**: the crawler fetches the same server that runs it. The fetch tool
  targets the SSR route only and is not a general-purpose fetch, so the agent cannot
  wander.
- **Both toggles off mid-stream**: turns keep arriving and accumulating off screen.
  Re-enabling shows them with the text gathered while hidden (`AC-FILTER-LIVE`).
- **Agent stops early**: if either agent ends its turn without advancing the dialogue,
  the exchange ends and the transcript shows a terminal entry rather than hanging.
- **Scripted and live must be indistinguishable to the client**: the client renders turn
  events and knows nothing about their origin. Only the banner differs.

### Findings raised at `/review-step` and rejected, with reasons

Recorded so they are decided rather than forgotten.

- **`decodeFrame` is hand-rolled rather than Effect Schema.** CLAUDE.md does say to use
  Schema at I/O boundaries, and `examples/tmux/src/transport-ws.ts` sets that precedent.
  Rejected here because the decoder must accept two shapes for the same field: an
  in-memory `Option` and the `string | null` a JSON frame carries. The reviewer noted only
  `transport-live.ts` calls it today, with JSON, so the `Option` branch looks dead. It is
  not: `encodeFrame` in `server/server.ts` writes `string | null` while both in-process
  transports hold `Option`, and the wire-shape tests exist precisely because that pairing
  was once untested. Rewriting as a Schema union is a real improvement and a real change
  to a validated boundary, so it belongs in its own change, not in a review pass. Left as
  is, deliberately, with the dual-shape rationale already in the JSDoc.
- **`import * as http` / `fs` / `path` for Node builtins.** CLAUDE.md's rule targets
  bundle size, and these are server-only modules that never enter the client bundle. The
  repo is not consistent here either. Not worth churn in a review pass.
- **`AgentRefusal.category` is `string | undefined` rather than `Option`.** Correct
  reading of the preference order, but the field mirrors the SDK's own optional field at
  an interop boundary, and no code populates it yet. Changing it now would be speculative.
- **`started` / `spoke` booleans lack an `is*` prefix.** They are function-local
  variables, not exported surface, and the surrounding code reads naturally. Cosmetic.
- **No concurrency cap on dialogues, and no explicit model-call timeout.** Real, and now
  much less exploitable with AC-SOCKET-ORIGIN in place: a foreign page can no longer open
  the socket at all. What remains is a developer opening many tabs of their own page,
  which is self-inflicted and visible. The SDK carries its own request timeout as a
  backstop. Out of scope for an example whose point is the transcript.
- **The AC-NO-KEY-IN-CLIENT import walk is textual, so a dynamic `import()` would evade
  it.** True. Nothing in `src/` uses dynamic import, and an AST walk is a bigger tool than
  this invariant needs today. Noted here so the limitation is known rather than assumed
  away.

### Why the fail-race test uses a 200ms interval

`transport-scripted.test.ts`'s "applies no further frames once the dialogue has failed"
looks like it is written with needlessly slow timings. It is not, and shortening it would
silently defang it.

The race only exists while the replay fiber is suspended **inside** `Effect.sleep` between
two deltas. The gap therefore has to be wide enough that the test is reliably sitting in it
when it calls `fail`. Measured against the unfixed replay: at a 200ms interval the turn's
text grows from 39 to 63 characters after `DialogueFailed` lands, and the test fails 3 runs
out of 3. At 30ms the pre-sleep check already catches the stop, the test passes with the
bug present, and it proves nothing.

Two weaker versions were tried first and both passed against the broken code: sleeping a
guessed 45ms, and waiting for the turn to appear rather than for its first delta (a turn
exists before any delta, so failing there is outside the window).

### A gap found at `/e2e`: `DialogueFailed` alone is not a transcript entry

AC-TRANSPORT-ERROR asks for a **terminal transcript entry**, and `/e2e` went looking for
an `error`-kind turn to assert against. Nothing in production emitted one. A failed model
call sent `DialogueFailed` and no turn, which moves the status pill to `failed` and appends
nothing, so the transcript just stopped mid-exchange with no statement of what happened.
`TurnKind`'s `"error"` member had no producer at all.

Why 1055 tests missed it: the existing test read only the **last** frame of a failed
dialogue, which was correct and stayed correct. Nothing asserted what came before it.

Fixed for the model-call path in `server/agents.ts`: a failure now opens an `error` turn,
writes the reason into it, and completes it before `DialogueFailed`. `AgentError` carries a
`speaker`, so the turn is attributed to the agent that failed. `SignalFetchError` has no
speaker and is thrown only from the crawler's fetch tool, so it is attributed there.

**Deliberately not fixed: the socket-drop path** in `src/transport-live.ts`, which still
emits `DialogueFailed` with no turn. A dropped socket has no speaker, and every turn must
have one to render. Attributing it to a speaker would make it **hideable by that speaker's
toggle**, so the message explaining why the page stopped could be filtered away, which is
worse than the current silence. The honest fix is a speaker-independent terminal entry,
which is new surface (`Turn.speaker` becoming optional, or a separate session field), so it
belongs to `/spec`, not to `/e2e`. Logged for a follow-up rather than guessed at here.

## Documentation Constraint

`noai` and `noimageai` are a **convention** that originated outside the standards
process. The readme frames this example as how to emit and read the signal, and stops
there.

It must not claim the signal prevents training, and it must not characterize who honors
it. Saying "adoption varies" is itself an adoption claim. Any statement about who
respects these directives has to be verified against a primary source before it is
written, or left out.

## Workflow Decisions

type-tests: not applicable, the surface has no generics, overloads, or inferred types, so
every signature is already fully enforced by `vp run check`.

Confirmed at `/type-tests` rather than assumed. Detail, since the skip has to be
reasoned and not silent:

- **Not a tooling exclusion.** Root `tstyche.json` `testFileMatch` includes
  `examples/**/*.tst.*`, so this package _is_ in TSTyche's scope. No example currently
  carries type tests, but that is precedent, not exclusion. The skip is about the surface.
- **Nothing to pin.** No declaration in `src/` or `server/` takes a type parameter, is
  overloaded, or returns a conditional or inferred type. Every return type is written out
  concretely, so there is no compiler deduction a consumer could observe and no
  assertion TSTyche could make that `vp run check` does not already make.
- **The one candidate, and why it was rejected.** `App` requires
  `DialogueTransport | Scope.Scope` in its `R` channel, and mounting without providing the
  layer must fail. That is enforced at the mount site by the main typecheck, and asserting
  it here would really be testing `Node`'s channel propagation, which is already
  type-tested inside `packages/core`. Duplicating it in an example proves nothing about
  this example.

Revisit if the surface ever grows a generic, an overload, or a type whose shape a
consumer has to infer.

- **E2E**: mandatory. This is an `examples/*` app, and the headline behaviour is
  browser-observable.

### What `/unit-test` does not cover, and why

Recorded so a reader does not mistake absence for oversight.

- **AC-LIVE has no unit test.** It needs a credential and a browser, and both are outside
  node-test scope. One assertion looked available, reading `mode === "live"` off
  `DialogueTransportLive` without connecting, and was rejected: passing it would constrain
  whether the layer touches `window` at build time, which nothing in the app requires.
  Verified by running the example with a credential.
- **`stop_reason` is exercised through a fake upstream, not a live call.** The seam is
  `DialogueOptions.baseUrl`. The SSE framing the fixture emits was verified against the
  installed SDK before the tests were written, so a failure there means the mapping is
  wrong, not that the fixture is.
- **Element identity across a toggle is `/e2e` scope.** `visibleTurns` preserves object
  identity and that is asserted here, but whether the keyed region reuses DOM nodes is a
  `List.each` reconciliation question and only observable in a browser.
