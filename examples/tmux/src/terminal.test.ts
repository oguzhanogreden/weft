import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import {
  ACCESSORY_KEYS,
  computePixelLock,
  controlByte,
  encodeKey,
  pixelLockStyle,
} from "./terminal";
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

// `encodeKey` only reads `key`/`ctrlKey`, so a literal stands in for a real
// event and these stay node tests with no DOM.
const keyEvent = (key: string, ctrlKey = false) => ({ key, ctrlKey }) as unknown as KeyboardEvent;

describe("controlByte (AC-MOBILE)", () => {
  it("maps a letter to its control byte, either case", () => {
    assert.equal(controlByte("c"), "\x03");
    assert.equal(controlByte("C"), "\x03");
    assert.equal(controlByte("a"), "\x01");
    assert.equal(controlByte("z"), "\x1a");
  });

  it("covers the bytes a shell actually needs", () => {
    assert.equal(controlByte("c"), "\x03"); // interrupt
    assert.equal(controlByte("d"), "\x04"); // EOF
    assert.equal(controlByte("b"), "\x02"); // tmux prefix
  });

  it("agrees with encodeKey's ctrl handling", () => {
    // Two paths to the same byte: a hardware Ctrl-c, and an armed sticky ctrl
    // applied to a soft-keyboard "c". They must not drift.
    for (const letter of ["a", "c", "d", "z"]) {
      assert.equal(controlByte(letter), encodeKey(keyEvent(letter, true)), letter);
    }
  });

  it("returns empty for anything without a control byte", () => {
    for (const char of ["1", "", "[", "ab", " "]) assert.equal(controlByte(char), "");
  });
});

describe("ACCESSORY_KEYS (AC-MOBILE)", () => {
  it("offers esc, tab, and the four arrows", () => {
    assert.deepEqual(
      ACCESSORY_KEYS.map((key) => key.label),
      ["esc", "tab", "↑", "↓", "←", "→"],
    );
  });

  it("omits ctrl, which is a modifier rather than a key that sends bytes", () => {
    assert.ok(!ACCESSORY_KEYS.some((key) => key.label === "ctrl"));
  });

  it("sends exactly what the hardware key would", () => {
    // The accessory row is a second route into the PTY; if it drifts from
    // `encodeKey`, a phone and a keyboard stop agreeing on what Tab means.
    const equivalent: Record<string, string> = {
      esc: "Escape",
      tab: "Tab",
      "↑": "ArrowUp",
      "↓": "ArrowDown",
      "←": "ArrowLeft",
      "→": "ArrowRight",
    };
    for (const key of ACCESSORY_KEYS) {
      assert.equal(key.bytes, encodeKey(keyEvent(equivalent[key.label]!)), key.label);
    }
  });

  it("never sends an empty byte string", () => {
    for (const key of ACCESSORY_KEYS) assert.ok(key.bytes.length > 0, key.label);
  });
});
