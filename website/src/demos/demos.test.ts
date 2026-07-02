import * as assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "vite-plus/test";
import { renderString } from "../__tests__/ssr";
import { demos, getDemo } from "./index";

const DOCS_ROOT = fileURLToPath(new URL("../../../docs", import.meta.url));

/** Collects every `demo=<id>` referenced by a fenced code block across all docs. */
async function referencedDemoIds(): Promise<Set<string>> {
  const files = (await readdir(DOCS_ROOT, { recursive: true })).filter((f) => f.endsWith(".md"));
  const ids = new Set<string>();
  for (const rel of files) {
    const source = await readFile(`${DOCS_ROOT}/${rel}`, "utf8");
    for (const match of source.matchAll(/```[^\n]*\bdemo=(\S+)/g)) {
      if (match[1]) ids.add(match[1]);
    }
  }
  return ids;
}

describe("demo registry", () => {
  it("AC1: getDemo returns a factory for a registered id, undefined otherwise", () => {
    assert.equal(typeof getDemo("reactive-counter"), "function");
    assert.equal(typeof getDemo("reactive-input"), "function");
    assert.equal(getDemo("does-not-exist"), undefined);
  });

  it("AC2: each factory returns a fresh Node per call", () => {
    const factory = getDemo("reactive-counter")!;
    assert.notEqual(factory(), factory());
  });

  it("AC3: every demo=<id> referenced in docs/**/*.md exists in the registry", async () => {
    const referenced = await referencedDemoIds();
    const missing = [...referenced].filter((id) => !demos.has(id));
    assert.deepEqual(missing, [], `dangling demo ids: ${missing.join(", ")}`);
  });

  it("AC5: demos render under SSR without error (interactivity covered by browser test)", async () => {
    const counter = await renderString(getDemo("reactive-counter")!());
    assert.match(counter, /counter-value/);
    assert.match(counter, />0</);

    const input = await renderString(getDemo("reactive-input")!());
    assert.match(input, /demo-input-field/);
    assert.match(input, /Type something…/);
  });
});
