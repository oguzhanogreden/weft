# Rendering pipeline: algorithmic analysis

Recorded 2026-07-27, following the first `perf-sweep.bench.ts` measurement pass (see
`next-steps.md`, item 9). Traces why the measured numbers look the way they do, and ranks
the optimization opportunities the code supports. Analysis only: nothing in this document
has been implemented.

## The pipeline, as it actually runs

```
PTY/synthetic bytes → feed() [ansi/parser.ts] → putChar/eraseInLine/... [grid.ts]
    → pump()'s row-reference diff [terminal.ts:128-145]
    → SubscriptionRef.set(rowRef) for changed rows only
    → renderRowCells: cols x { style stream, char stream } [terminal.ts:214-223]
    → @weftui/dom: subscribeToStream -> Stream.runForEach -> Effect.sync(write) [render.ts:388-399]
```

Every stage from `feed` through the row diff is already efficient. The break is at the
last stage, and it is precise enough to name exactly.

## The dominant bottleneck: `handleStyle` never diffs

`packages/dom/src/client/render.ts:104` dispatches any prop named `style` straight to
`handleStyle` (`render.ts:245`). For a stream of style objects, `render.ts:260-269` runs
on every emission:

```js
element.style.cssText = ""; // unconditional reset
for (const [key, styleValue] of Object.entries(val)) {
  if (styleValue !== undefined && styleValue !== null) {
    element.style.setProperty(camelToKebab(key), String(styleValue));
  }
}
```

No comparison against the previously-applied value, anywhere. Contrast this with the
plain-text child path one file away: `updateStreamChild` (`render.ts:1279-1284`) already
does the right thing, `if (only.data !== text) only.data = text`. Text is diffed. Style is
not.

It is worse than merely undiffed. `cellStyle` (`terminal.ts:200-211`) always emits all
five keys, using `""` for unset ones, deliberately, per its own JSDoc, so a cleared
attribute does not go stale. The guard above is `!== undefined && !== null`. An empty
string passes that guard. So `setProperty(name, "")` fires for real, for every key, for
every cell, on every row touch.

The benchmark's own synthetic load (`generateFrameBytes` in `perf.ts`) never emits an SGR
code, so every cell in that whole sweep is `DEFAULT_STYLE`. The measured 8x gap (600 vs
4800 rows/s at 160x48, from `perf-sweep.bench.ts`'s sweep A) is being spent almost
entirely on one `cssText` clear plus five no-op `setProperty` calls per cell, per row,
styling nothing. This is not a hypothesis fitted after the fact. It is the mechanism the
number already reported.

**Why `rows/s` drops too, not just `fps`:** `subscribeToStream` (`render.ts:388-399`) runs
`Stream.runForEach` synchronously via `Effect.sync`. No batching, no
`requestAnimationFrame`, no microtask coalescing anywhere in the file. Rendering is not
decoupled from the parser pump: a slow cell-write fan-out backs the whole
chunk-processing fiber up, which is what `pump`'s own throughput meter measures.

## Secondary findings, ranked by leverage

1. **`cellStyle` allocates a fresh object every call** (`terminal.ts:200`). Even a
   reference-equality fast path in core could never fire against this. Memoize it by
   `Style` reference (`WeakMap<Style, Record<string, string>>`); most cells share the
   literal `DEFAULT_STYLE`/`BLANK_CELL` constant (`grid.ts:57`, `grid.ts:66`), so this is a
   high-hit-rate, essentially free cache. A necessary complement to fixing the primary
   issue, not a substitute for it.
2. **One supervised fiber per stream binding** (`forkSupervised`, called from
   `subscribeToStream`). `renderRowCells` opens 2 streams per cell (style + char), so a
   grid opens `2 x cols x rows` live fibers: 15,360 at 160x48, 28,800 at 240x60. `low`
   strategy opens `1 x rows` (48). This is a mount/teardown cost, not a per-frame one,
   and almost certainly explains why the top preset takes ~3.5s to mount and why every
   sweep-B size switch is expensive regardless of strategy.
3. **No rAF/microtask batching.** Real, but the data says it is secondary here: `low`
   absorbs the same ~250 offers/sec `makeLoadStream` emits and holds the environment's
   fps ceiling. Per-emission _cost_ is the active constraint, not emission _count_.
   Batching would help once the primary issue is fixed, not before.
4. **`putChar`'s row copy is O(cols^2) per line fill** (`grid.ts:120-131`, `row.slice()`
   on every character). Real, but already ruled out as the binding constraint: `low`/`med`
   parse the identical byte stream through the identical parser and never degrade.

## A falsifiable prediction

Fix the primary issue (diff `handleStyle` against the last-applied value instead of
reset-and-reapply) and re-run `vp run bench`. Expect `high`'s rows/s at 160x48 to converge
toward `med`'s (~2300), not stay near 600. Whatever gap remains after that is fiber
fan-out (finding 2), which needs a different fix: fewer bindings per cell, e.g. one
combined stream instead of two.

## Status

Analysis only. `packages/dom` has not been touched. `handleStyle` is core public-surface
code, which per the project's TDD workflow pulls in the full `/spec` cycle with a
high-effort review gate at `packages/core`/`packages/dom` touches. Start there if this is
picked up.
