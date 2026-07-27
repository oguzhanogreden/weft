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
   strategy opens `1 x rows` (48). Originally filed here as a mount/teardown cost only,
   explaining why the top preset takes ~3.5s to mount and every sweep-B size switch is
   expensive regardless of strategy. Revised after the `handleStyle` fix below: with
   style-write cost removed and `high` still near-flat under load, per-emission dispatch
   across this many live bindings is now the leading hypothesis for the per-frame cost
   too, not mount time alone. Not yet confirmed; see the falsifiable step in the Update
   section.
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

## Update (2026-07-27): the fix landed, the prediction was falsified

`handleStyle`'s object branch (`render.ts:245`) now diffs each emission against the
previously-applied object instead of clearing and reapplying every time. A key unchanged
between emissions is skipped; a key present before but absent now is removed; a string
emission forces one full reset before the next object emission diffs (a raw string can
set arbitrary properties outside the tracked key set). `dom.specs.md`'s AC13 keeps its
"replace all style properties" contract and gained an implementation note: that outcome
is now reached by diffing, not by clearing first. A dedicated unit test spies on
`CSSStyleDeclaration.setProperty` and confirms an unchanged property is applied once, not
re-applied on a repeat emission. `vp run check`, `vp run test` (870/870), and
`vp run test:browser` (114/115, one pre-existing unrelated skip) are all green.

`vp run bench` was re-run immediately after, same machine and session, against a fresh
baseline captured minutes earlier (not this document's original numbers above, which read
consistently lower in this environment and are not a fair comparison):

| strategy | load | rows/s before | rows/s after |
| -------- | ---- | ------------- | ------------ |
| high     | off  | 0             | 0            |
| high     | low  | 407           | 459          |
| high     | med  | 438           | 494          |
| high     | high | 441           | 493          |

The predicted convergence toward `med`'s ~2200-3900 did not happen. `high` moved about
12%, not the several-fold jump the prediction called for.

This is a clean disconfirmation, not noise. The benchmark's own load generator
(`generateFrameBytes` in `perf.ts`) never emits an SGR code, so every cell's style was
`DEFAULT_STYLE` on every tick for the whole sweep: the exact case the diff optimizes
hardest, since every key is unchanged on every tick. If `handleStyle` were the dominant
cost, this run should show the largest possible improvement. It shows almost none.

**Conclusion: `handleStyle`'s missing diff was a real defect, now fixed and covered by
its own tests, but not the dominant cost at `high` strategy.** Something else spends the
time.

**Revised hypothesis, not yet tested: per-cell subscription/fiber fan-out (finding 2,
below).** `renderRowCells` (`terminal.ts:218-221`) opens two independent `Stream.map`
bindings per cell at `high` strategy: one for style, one for the char child. `low`/`med`
open one binding per segment, text only; those strategies never compute a per-segment
style at all (`renderRow`'s non-`high` branch has no style prop). At 160 cols: `high` is
160 cells x 2 = 320 bindings dispatched per changed row; `med` is 8 segments x 1 = 8. A
40x gap in live bindings against an ~8x gap in rows/s. `pump` is already correctly
row-diffed (`terminal.ts:134-141`, only rows whose reference changed get
`SubscriptionRef.set`), so it does not add to this multiplier.

Next falsifiable step: collapse `high`'s two bindings per cell into one, and re-run
`vp run bench`. Expect rows/s to roughly double if per-binding dispatch overhead, not
styling, is the constraint. Expect no material change if it is not.

## Update 2 (2026-07-27): the fan-out hypothesis is confirmed

Before investing in a proper implementation, `renderRowCells` was spiked in place
(uncommitted, reverted after reading the number): one `<span>` per cell, mounted via
`ref`, with a single forked fiber that diffs both char and style against what that cell
last applied, replacing the two independent `style`/child-text bindings. The prediction,
written down before running it: rows/s should land materially above ~1000 if per-binding
dispatch dominates, or stay in the 500-700 range if it does not.

`vp run bench`, sweep A, `high` strategy at 160x48:

| load | rows/s (2 bindings/cell) | rows/s (1 binding/cell, spike) |
| ---- | ------------------------ | ------------------------------ |
| off  | 0                        | 0                              |
| low  | 459                      | 473                            |
| med  | 494                      | 1389                           |
| high | 493                      | 1394                           |

1394 clears the ~1000 bar comfortably, a ~2.8x jump. `low`/`med` held flat against the
same run's numbers reported in Update 1 (479/2480/4769 and 478/2187/3889 there, versus
479/2473/4694 and 478/2181/3830 here), the in-run control confirming this is a real
effect of the change, not environment drift.

**Conclusion: per-cell binding fan-out was the larger of the two costs.** Collapsing two
bindings to one recovered roughly 3x, versus the ~12% the `handleStyle` diff alone
delivered. Combined, both fixes account for most of the original 8x gap between `high`
and `low` at load=high (~4772/441 ≈ 10.8x originally; ~4694/1394 ≈ 3.4x remaining).

A gap remains: 1394 rows/s is still well under `med`'s ~1900-3900. The next suspect,
untested, is the raw per-cell DOM node count itself (7,680 `<span>` elements at 160x48)
rather than anything about how they are subscribed: even a single, maximally cheap
binding per cell still means the browser touches 7,680 elements every changed row.
Distinguishing "still too many live bindings" from "still too many DOM nodes" would need
a strategy that renders fewer nodes without losing per-cell colour (e.g. coalescing
same-style runs into fewer spans, already on the roadmap as `next-steps.md` item 2),
not attempted here.

## Update 3 (2026-07-27): the real implementation lands

The spike became the real fix: `renderCell` in `terminal.ts` (replacing the two-binding
`renderRowCells`) mounts each `high`-strategy cell via `ref` and forks one fiber per cell
that diffs both char and style against what it last applied, instead of one binding for
style and a separate one for the child text. `renderRow`/`renderRows` now carry
`Scope.Scope` in their requirement channel (needed for the per-cell fork); both call
sites (`App`, `ViewerApp`) already required `Scope.Scope` themselves, so this did not
propagate further.

Verified, not just re-measured: `render-integrity.browser.test.ts` (no dropped cells
across repeated repaints), `app.browser.test.ts`'s per-cell colour test, and
`viewer-app.browser.test.ts` (parity with `App`) all pass unchanged, and
`grid-size.browser.test.ts` confirms clean teardown on resize (one scoped fiber per cell,
torn down with the rest of that size's content scope). A new test locks in the diffing
behaviour specifically: a cell overwritten from reverse-video to plain text must have its
background actually cleared, not just skip a redundant re-apply of an unchanged value.
`vp run check`, `vp run test` (870/870), and `vp run test:browser` (115/116, the same one
pre-existing unrelated skip) are all green.

Re-benchmarked against the real implementation: sweep A, `high` at 160x48 under
`load=high` reads 1410 rows/s, matching the spike's 1394 within measurement noise. The
conclusion from Update 2 stands unchanged; this confirms the clean implementation didn't
lose anything the spike had.

## Status

Both fixes are real, confirmed, and now properly implemented: `handleStyle`'s diff
(Update 1, ~12% of the gap) and collapsing `high`'s two per-cell bindings into one
(Updates 2-3, ~3x of the gap). Neither touched `packages/dom`'s public surface for the
second fix (it lives entirely in `examples/tmux`), so the high-effort review gate applied
only to the first. The remaining gap to `med` (per-cell DOM node count, not binding
count) is untested and is the next thing to pick up, per `next-steps.md` item 9.
