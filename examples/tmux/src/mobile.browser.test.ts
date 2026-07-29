/**
 * Browser test for touch input (`src/specs.md`, AC-MOBILE).
 *
 * The soft-keyboard path cannot be exercised with synthetic `keydown`: on a real
 * phone the browser reports `key: "Unidentified"`, `encodeKey` returns "", and
 * the character arrives as an `input` event on the hidden textarea instead. So
 * these tests drive that element directly, which is the path a phone takes.
 *
 * Pinned to 80x24 throughout: none of this is about grid size, and the small
 * grid keeps the run cheap.
 */

import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { type AppOptions, App } from "./app";
import { ACCESSORY_KEYS } from "./terminal";
import { makeMockTransport } from "./transport-mock";

let container: HTMLElement;
let app: WeftApp.WeftApp;

const SMALL: AppOptions = { cols: 80, rows: 24 };

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await Effect.runPromise(WeftApp.dispose(app));
  container.remove();
});

const mountApp = async () => {
  const mock = makeMockTransport(["$ "]);
  app = WeftApp.make(mock.layer);
  await Effect.runPromise(WeftApp.mount(app, App(SMALL), container));
  const field = await vi.waitFor(() => {
    const el = container.querySelector<HTMLTextAreaElement>(".term-input");
    expect(el).not.toBeNull();
    return el!;
  });
  return { mock, field };
};

/** Type `text` the way a soft keyboard does: into the field, then an input event. */
const softType = (field: HTMLTextAreaElement, text: string) => {
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

const tap = (selector: string) => container.querySelector<HTMLButtonElement>(selector)!.click();

describe("touch input (AC-MOBILE)", () => {
  it("renders a focusable textarea rather than hiding it from focus", async () => {
    // `display: none` would be unfocusable, and an unfocusable field never
    // summons the keyboard. It must be in the layout, just invisible.
    const { field } = await mountApp();
    field.focus();
    expect(document.activeElement).toBe(field);
  });

  it("keeps the keyboard from mangling shell input", async () => {
    const { field } = await mountApp();
    await vi.waitFor(() => {
      expect(field.getAttribute("autocapitalize")).toBe("off");
      expect(field.getAttribute("autocorrect")).toBe("off");
      // The IDL property, which reflects the attribute however it was applied.
      expect(field.spellcheck).toBe(false);
    });
  });

  it("focuses the field when the pane is tapped, so the keyboard opens", async () => {
    const { field } = await mountApp();
    container.querySelector<HTMLElement>(".terminal-pane")!.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
  });

  it("sends characters that arrive as input events, the path keydown misses", async () => {
    const { mock, field } = await mountApp();
    softType(field, "l");
    softType(field, "s");
    await vi.waitFor(() => expect(mock.writes.join("")).toBe("ls"));
  });

  it("clears the field after each read, so characters are not resent", async () => {
    const { mock, field } = await mountApp();
    softType(field, "a");
    await vi.waitFor(() => expect(field.value).toBe(""));
    softType(field, "b");
    await vi.waitFor(() => expect(mock.writes.join("")).toBe("ab"));
  });

  it("renders an accessory key for every entry, plus ctrl", async () => {
    await mountApp();
    const labels = [...container.querySelectorAll("[data-accessory]")].map((el) =>
      el.getAttribute("data-accessory"),
    );
    expect(labels).toEqual([...ACCESSORY_KEYS.map((key) => key.label), "ctrl"]);
  });

  it("sends the right bytes for each accessory key", async () => {
    const { mock } = await mountApp();
    for (const key of ACCESSORY_KEYS) tap(`[data-accessory="${key.label}"]`);
    await vi.waitFor(() =>
      expect(mock.writes.join("")).toBe(ACCESSORY_KEYS.map((key) => key.bytes).join("")),
    );
  });

  it("arms and disarms ctrl without sending anything", async () => {
    const { mock } = await mountApp();
    const ctrl = container.querySelector<HTMLElement>('[data-accessory="ctrl"]')!;
    await vi.waitFor(() => expect(ctrl.dataset.armed).toBe("false"));

    tap('[data-accessory="ctrl"]');
    await vi.waitFor(() => expect(ctrl.dataset.armed).toBe("true"));

    tap('[data-accessory="ctrl"]');
    await vi.waitFor(() => expect(ctrl.dataset.armed).toBe("false"));
    expect(mock.writes).toEqual([]); // arming is not itself a keystroke
  });

  it("turns the next character into its control byte, then disarms", async () => {
    // Ctrl-C is the whole reason the modifier exists.
    const { mock, field } = await mountApp();
    tap('[data-accessory="ctrl"]');
    await vi.waitFor(() =>
      expect(container.querySelector<HTMLElement>('[data-accessory="ctrl"]')!.dataset.armed).toBe(
        "true",
      ),
    );

    softType(field, "c");
    await vi.waitFor(() => expect(mock.writes.join("")).toBe("\x03"));

    // One-shot: the character after it is literal again.
    softType(field, "c");
    await vi.waitFor(() => expect(mock.writes.join("")).toBe("\x03c"));
  });
});

describe("responsive chrome (AC-MOBILE)", () => {
  it("renders a controls toggle that flips the groups' open state", async () => {
    // The toggle is CSS-hidden on fine pointers, but the state it drives is what
    // the narrow-screen media query keys on, so assert the state not the pixels.
    await mountApp();
    const groups = container.querySelector<HTMLElement>(".control-groups")!;
    await vi.waitFor(() => expect(groups.dataset.open).toBe("false"));

    tap("[data-controls-toggle]");

    await vi.waitFor(() => expect(groups.dataset.open).toBe("true"));
  });

  it("keeps the meters outside the collapsible groups", async () => {
    // Watching fps is the point of the harness, so the meters must stay visible
    // when the groups collapse on a phone.
    await mountApp();
    const groups = container.querySelector<HTMLElement>(".control-groups")!;
    expect(groups.querySelector(".meter")).toBeNull();
    expect(container.querySelector(".meter.fps")).not.toBeNull();
  });
});
