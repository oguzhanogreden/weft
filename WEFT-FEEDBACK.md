# Weft feedback

Framework-level findings surfaced while building examples: defects, workarounds, and
non-obvious characteristics that belong to `packages/*`, not to whichever example
found them. Collected here across the whole repo, cross-referenced from wherever each
one was found. See CLAUDE.md's Meta Rules for when to add an entry.

## Open

### `spellcheck` is typed as a string but assigned as a boolean

`@weftui/core` types `spellcheck` as `HTMLAttributeSource<"true" | "false">`, but
`@weftui/dom`'s renderer assigns it to the boolean IDL property, so the documented
value `"false"` is a truthy string and turns spellcheck **on**. The element renders as
`spellcheck="true"`. Any prop whose IDL property is boolean while the type is a string
union has the same problem, so the fix is probably in the property/attribute decision
in `packages/dom`, not in the one type.

Found in: `examples/tmux` (AC-MOBILE, the hidden textarea), worked around there by
setting it through the ref. See `examples/tmux/next-steps.md`, item 4.

### `HTMLAutocomplete` has no `"off"`

The union lists field-name tokens only, so the spec-legal `autocomplete="off"` does
not typecheck.

Found in: `examples/tmux` (AC-MOBILE), worked around there by omitting the attribute.
See `examples/tmux/next-steps.md`, item 4.

### A reactive child's structural mount and its first emission can land in different scheduler ticks

Mounting an element with a `Stream`-valued child inserts the element (and its marker
comments) synchronously, but the stream's first value can arrive a scheduler tick
later. Code that checks "the element exists" immediately after a mount or rebuild can
observe it before any content has rendered. Not a data bug: the correct value always
arrives, per `SubscriptionRef.changes`'s documented "current value first, then future
changes" semantics. It is a timing assumption that's easy to get wrong, in a test or
in consuming code.

Found in: `examples/tmux` (`pixel-grid.browser.test.ts`), after collapsing a render
strategy's cell bindings made teardown fast enough to expose a gap that slower
teardown had previously masked. Possibly not a defect to fix so much as something to
document clearly for `@weftui/dom` consumers ("wait for content, not structure, after
a reactive rebuild"). The mechanism for why some teardown paths expose it and others
don't is untraced. See `examples/tmux/perf-analysis.md`, Update 4.

### A reactive attribute or boolean prop paints its element before applying its first value

The same tick gap as the reactive-child entry above, but for props rather than children,
and with a user-visible consequence rather than only a test-timing one.

An element whose attribute is `Stream`-valued is inserted without that attribute, which
then appears a tick later. For `data-*` that is invisible. For a boolean IDL property it
is not: a checkbox bound to a stream whose first value is `true` paints **unchecked**, then
corrects itself. In a real app with CSS that is a flash of the wrong state on every mount.

A consumer cannot avoid it. There is no way to pass a static initial value alongside a
stream for the same prop, so `checked: Stream.map(…)` is the only expressible form and it
necessarily starts from the element's default. If props accepted an initial value plus a
stream, or applied the stream's already-available current value during element creation,
the flash would not exist.

Found in: `examples/noai` (`src/app.browser.test.ts`, AC-FILTER's "starts with both
toggles on", and `data-complete` in AC-STREAM). Both toggles render off for a tick before
showing their real state. Worked around in the test with `vi.waitFor`; not worked around in
the app, because it cannot be from outside `packages/dom`.

### `oxfmt` does not converge on an indented paragraph inside a checklist item

A markdown list item with a second paragraph indented to align with its text is reformatted
by `oxfmt` into deeper and deeper indentation each pass, so it never reaches a fixed point.

The failure mode is worse than the formatting itself. `vp check --fix` exits **pass** while
`vp run check` keeps reporting the same file as unformatted, which reads as a broken cache
or a stale build rather than as a file the formatter cannot settle. `vp fmt --check` names
the file; `--fix` does not.

Workaround: unindent the continuation to column 0, i.e. end the list and continue as
ordinary prose. Found in `examples/noai/src/specs.md` while adding an acceptance criterion
with a multi-paragraph rationale.

### A new workspace package's tests are silently skipped until it is added to root `test.projects`

`vp run test` discovers tests through `test.projects` in the root `vite.config.ts`, an
explicit list. A new workspace package with perfectly good `*.test.ts` files contributes
zero tests until it is added there, and the run stays green throughout. Nothing warns.

The same applies one level down: a package whose tests live outside `src/` needs its own
`test.include` to cover them.

`examples/tmux` makes this easier to get wrong rather than harder. Its `server/` is
deliberately outside the workspace, excluded from `fmt` and `lint` at the root, and tested
via a bare `node --test`, because `node-pty` is a native addon. Copying that shape for an
ordinary dependency inherits the exclusions without the reason, and the server tests never
run in CI.

Verify positively when adding a package: add a throwaway test and confirm the reported
file count moves. A green run is not evidence of discovery.

Found in: `examples/noai`, where the server is in-workspace (its `@anthropic-ai/sdk`
dependency needs no native-addon escape hatch) and both the root `test.projects` entry and
a package-level `test.include` were required. Recorded with the surrounding agent-workflow
learnings in `plans/effect-api-digest-proposal.md` (untracked; `plans/` is gitignored).

### The example convention leaves every thin entry structurally untested

Examples are split into a side-effect-free `app.ts` exporting `App` and a thin entry
(`main.ts` or `entry-client.ts`) that mounts it. The split is what makes `app.ts` importable,
and the browser test imports exactly that. The entry is therefore the one file no test
reaches, in every example, by construction.

That is usually harmless, because most entries only pick a root element and mount. It stops
being harmless once an entry makes a decision. `examples/noai`'s entry reads a server-written
`<meta>` tag to choose between the live and scripted transports, and its failure mode is
silent: a wrong read sends a keyless dev server to the live transport, and a mount failure
goes to `console.error` with a blank `#root` left behind.

The gap is not visible from the test output. Both the unit and browser suites can be fully
green while the page a person actually opens is blank.

Worth deciding repo-wide rather than per example: either keep entries dumb enough that no
test is owed, or give any entry that branches a home a test can reach. `examples/noai` took
the first route in spirit but not in fact, and its one decision is now covered only by a
manual check recorded in `src/specs.md`.

Found in: `examples/noai` at `/document`, verifying the served page by hand because nothing
automated could.

## Resolved

### A reactive child's first emission was discarded if it arrived before its markers attached

Fixed in `@weftui/dom` and guarded in `@weftui/core`. Found via `examples/tmux`'s
render-integrity tests (about 0.15% of cells rendered empty). See
`examples/tmux/next-steps.md`, "Where it stands".
