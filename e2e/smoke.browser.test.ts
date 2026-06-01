/**
 * Browser-mode smoke test.
 *
 * Guards the end-to-end testing infrastructure rather than any single feature:
 * it verifies that the Playwright-backed Vitest browser environment boots and
 * that real-browser primitives (a live `window`/`navigator` and a real DOM) are
 * available. If this fails, the e2e harness is misconfigured.
 */
import { describe, expect, it } from "vite-plus/test";

describe("browser e2e smoke", () => {
  it("runs inside a real browser environment", () => {
    expect(typeof window).toBe("object");
    expect(navigator.userAgent).toContain("Chrome");
  });

  it("can mutate the real DOM", () => {
    const element = document.createElement("div");
    element.textContent = "effect-ui";
    document.body.append(element);

    expect(document.body.contains(element)).toBe(true);
    expect(element.textContent).toBe("effect-ui");

    element.remove();
    expect(document.body.contains(element)).toBe(false);
  });
});
