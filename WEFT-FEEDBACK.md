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

## Resolved

### A reactive child's first emission was discarded if it arrived before its markers attached

Fixed in `@weftui/dom` and guarded in `@weftui/core`. Found via `examples/tmux`'s
render-integrity tests (about 0.15% of cells rendered empty). See
`examples/tmux/next-steps.md`, "Where it stands".
