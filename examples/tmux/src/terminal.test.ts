import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { computePixelLock, pixelLockStyle } from "./terminal";
import type { CellMetrics, PixelLock } from "./terminal";

/** True when `cssPx × dpr` lands on a whole device pixel (AC-PIXELGRID tolerance). */
const isWholeDevicePx = (cssPx: number, dpr: number): boolean =>
  Math.abs(cssPx * dpr - Math.round(cssPx * dpr)) < 0.05;

describe("computePixelLock (AC-PIXELGRID)", () => {
  it("snaps a fractional cell advance to a whole device pixel at dpr 1", () => {
    // The measured default: 7.83px advance at the 13px font.
    const lock = computePixelLock({ advance: 7.8266, height: 16.25 }, 1);
    assert.equal(lock.cellWidth, 8);
    assert.ok(isWholeDevicePx(lock.cellWidth, 1));
    assert.ok(
      Math.abs(lock.letterSpacing - 0.1734) < 1e-6,
      `letterSpacing was ${lock.letterSpacing}`,
    );
  });

  it("snaps to whole DEVICE pixels, not css pixels, at dpr 2", () => {
    // 7.6 css px × 2 = 15.2 device px → 15 device px → 7.5 css px.
    // Snapping in css px would instead give 8; this pins device-px snapping.
    const lock = computePixelLock({ advance: 7.6, height: 16.25 }, 2);
    assert.equal(lock.cellWidth * 2, 15);
    assert.equal(lock.cellWidth, 7.5);
    assert.ok(isWholeDevicePx(lock.cellWidth, 2));
    assert.ok(Math.abs(lock.letterSpacing + 0.1) < 1e-6, `letterSpacing was ${lock.letterSpacing}`);
  });

  it("snaps the row height to a whole device pixel (replacing fractional 16.25)", () => {
    const lock = computePixelLock({ advance: 8, height: 16.25 }, 1);
    assert.equal(lock.rowHeight, 16);
    assert.ok(isWholeDevicePx(lock.rowHeight, 1));
  });

  it("leaves already-integer metrics unchanged (letterSpacing 0)", () => {
    const lock = computePixelLock({ advance: 8, height: 16 }, 1);
    assert.equal(lock.cellWidth, 8);
    assert.equal(lock.rowHeight, 16);
    assert.equal(lock.letterSpacing, 0);
  });

  it("always yields whole-device-px advance/row, with letterSpacing = cellWidth - advance", () => {
    const samples: ReadonlyArray<CellMetrics> = [
      { advance: 7.8266, height: 16.25 },
      { advance: 6.4, height: 14.9 },
      { advance: 9.6, height: 18.75 },
      { advance: 8, height: 16 },
    ];
    for (const dpr of [1, 2]) {
      for (const m of samples) {
        const lock = computePixelLock(m, dpr);
        assert.ok(isWholeDevicePx(lock.cellWidth, dpr), `cellWidth ${lock.cellWidth} @dpr${dpr}`);
        assert.ok(isWholeDevicePx(lock.rowHeight, dpr), `rowHeight ${lock.rowHeight} @dpr${dpr}`);
        assert.ok(Math.abs(lock.letterSpacing - (lock.cellWidth - m.advance)) < 1e-9);
      }
    }
  });
});

describe("pixelLockStyle (AC-PIXELGRID)", () => {
  it("emits letter-spacing and line-height as px strings for the grid container", () => {
    const lock: PixelLock = { cellWidth: 8, rowHeight: 16, letterSpacing: 0.2 };
    const style = pixelLockStyle(lock);
    assert.equal(style.letterSpacing, "0.2px");
    assert.equal(style.lineHeight, "16px");
  });
});
