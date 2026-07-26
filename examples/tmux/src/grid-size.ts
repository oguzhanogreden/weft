/**
 * Grid size as a perf-harness axis (see `src/specs.md`, AC-GRIDSIZE).
 *
 * The third variable alongside render strategy and synthetic load: how many
 * cells exist at all. At `high` each cell holds two live subscriptions, so the
 * presets span 3,840 subscriptions (80x24) to 28,800 (240x60), which is enough
 * to find where the reactive engine caps out.
 *
 * Kept out of `perf.ts` (meters and load generation) and out of `app.ts` (the
 * component) so the presets, the reconciliation key, and the URL parsing sit in
 * one place and stay unit-testable without a DOM.
 */

/** A grid size in character cells. */
export interface GridSize {
  readonly cols: number;
  readonly rows: number;
}

/** The classic terminal default, and the size the app opens at. */
export const DEFAULT_GRID_SIZE: GridSize = { cols: 80, rows: 24 };

/**
 * Upper bound on a URL-supplied size. Bounds a typo (`?cols=99999`) to something
 * that still renders, rather than hanging the tab before first paint. Not a
 * comfort limit: 400x200 stays deliberately reachable, since finding the cliff
 * is the point of the axis. The presets stop well short, at 240x60.
 */
export const GRID_SIZE_MAX: GridSize = { cols: 400, rows: 200 };

/**
 * Control-bar presets, ascending by cell count (1,920 to 14,400). Roughly
 * doubling each step gives the cost curve five points; the top step is expected
 * to be punishing rather than usable.
 */
export const GRID_SIZES: ReadonlyArray<GridSize> = [
  DEFAULT_GRID_SIZE,
  { cols: 120, rows: 40 },
  { cols: 160, rows: 48 },
  { cols: 200, rows: 50 },
  { cols: 240, rows: 60 },
];

/**
 * `"80x24"`. Serves as both the button label and the reconciliation key for the
 * size-keyed list, so the rendered label and the identity that drives teardown
 * can never disagree.
 */
export function gridSizeLabel(size: GridSize): string {
  return `${size.cols}x${size.rows}`;
}

/** One dimension: a positive integer clamped to `max`, else `fallback`. */
function dimension(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

/**
 * Read `?cols=&rows=` out of a location search string, clamped to
 * {@link GRID_SIZE_MAX}. Each dimension falls back independently, so `?cols=200`
 * alone keeps the fallback's rows. Non-integer, zero, and negative values are
 * rejected in favour of the fallback.
 *
 * Takes the raw search string rather than reading `location`, so it is pure and
 * testable outside a browser.
 */
export function parseGridSize(search: string, fallback: GridSize): GridSize {
  const params = new URLSearchParams(search);
  return {
    cols: dimension(params.get("cols"), fallback.cols, GRID_SIZE_MAX.cols),
    rows: dimension(params.get("rows"), fallback.rows, GRID_SIZE_MAX.rows),
  };
}
