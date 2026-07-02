import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { type HastElement, type HastNode, parseDoc } from "./markdown-loader";

const DOCS_ROOT = "/repo/docs";
const GUIDE_PATH = "/repo/docs/guides/getting-started.md";

/** Recursively collects every element with the given tag name. */
function findAll(node: HastNode, tagName: string): HastElement[] {
  const out: HastElement[] = [];
  const walk = (n: HastNode): void => {
    if (n.type === "element") {
      if (n.tagName === tagName) out.push(n);
      for (const c of n.children) walk(c);
    } else if (n.type === "root") {
      for (const c of n.children) walk(c);
    }
  };
  walk(node);
  return out;
}

/** First element with the given tag name, or `undefined`. */
function find(node: HastNode, tagName: string): HastElement | undefined {
  return findAll(node, tagName)[0];
}

/** Concatenated text of a node. */
function textOf(node: HastNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "element" || node.type === "root") return node.children.map(textOf).join("");
  return "";
}

describe("parseDoc", () => {
  it("AC1/AC2: produces a DocModel with slug, category, path, and parsed frontmatter", async () => {
    const doc = await parseDoc(
      `---
title: Getting Started
order: 1
section: guides
description: Intro doc.
---

# Getting Started

Hello.
`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    assert.equal(doc.slug, "getting-started");
    assert.equal(doc.category, "guides");
    assert.equal(doc.path, "guides/getting-started");
    assert.deepEqual(doc.frontmatter, {
      title: "Getting Started",
      order: 1,
      section: "guides",
      description: "Intro doc.",
    });
    assert.equal(doc.tree.type, "root");
  });

  it("AC2: throws when the required title is missing", async () => {
    await assert.rejects(
      () => parseDoc(`---\norder: 1\n---\n\n# No title here\n`, GUIDE_PATH, DOCS_ROOT),
      /Missing required frontmatter "title"/,
    );
  });

  it("AC2: order defaults to Infinity and section defaults to the directory name", async () => {
    const doc = await parseDoc(`---\ntitle: Loose\n---\n\nbody\n`, GUIDE_PATH, DOCS_ROOT);
    assert.equal(doc.frontmatter.order, Infinity);
    assert.equal(doc.frontmatter.section, "guides");
    assert.equal(doc.category, "guides");
  });

  it("AC2: frontmatter is stripped from the rendered tree", async () => {
    const doc = await parseDoc(`---\ntitle: T\n---\n\n# Heading\n`, GUIDE_PATH, DOCS_ROOT);
    assert.equal(textOf(doc.tree).includes("title: T"), false);
  });

  it("AC3: GFM tables are supported", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n| A | B |\n| - | - |\n| 1 | 2 |\n`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    assert.ok(find(doc.tree, "table"), "expected a <table> element");
    assert.equal(findAll(doc.tree, "td").length, 2);
  });

  it("AC4: headings get stable ids, anchor links, and a headings entry", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n## First Section\n\ntext\n\n### Nested\n`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    const h2 = find(doc.tree, "h2");
    assert.equal(h2?.properties["id"], "first-section");
    assert.ok(find(doc.tree, "a"), "expected an anchor link inside the heading");
    assert.deepEqual(doc.headings, [
      { depth: 2, id: "first-section", text: "First Section" },
      { depth: 3, id: "nested", text: "Nested" },
    ]);
  });

  it("AC5: fenced code is highlighted to hast (not a string) with Shiki token spans", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    const pre = find(doc.tree, "pre");
    assert.ok(pre, "expected a <pre> element");
    assert.equal(pre?.properties["dataLang"], "ts");
    assert.equal(pre?.properties["dataRaw"], "const x = 1;");
    assert.ok(findAll(doc.tree, "span").length > 0, "expected highlighted token spans");
  });

  it("AC6: a demo=<id> fence retains a dataDemo marker and the raw source", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n\`\`\`ts demo=reactive-counter\nCounter();\n\`\`\`\n`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    const pre = find(doc.tree, "pre");
    assert.equal(pre?.properties["dataDemo"], "reactive-counter");
    assert.equal(pre?.properties["dataRaw"], "Counter();");
  });

  it("AC7: disallowed raw-HTML element types never appear in the output", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n<script>alert(1)</script>\n\nSafe paragraph.\n`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    assert.equal(findAll(doc.tree, "script").length, 0);
    assert.equal(findAll(doc.tree, "style").length, 0);
    assert.equal(findAll(doc.tree, "iframe").length, 0);
    assert.ok(textOf(doc.tree).includes("Safe paragraph."));
  });

  it("rewrites relative inter-doc .md links uniformly to /docs/:section/:slug", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n[routing](./routing.md) and [core](../reference/core.md) and [effect](https://effect.website)\n`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    const hrefs = findAll(doc.tree, "a").map((a) => a.properties["href"]);
    assert.ok(hrefs.includes("/docs/guides/routing"));
    assert.ok(hrefs.includes("/docs/reference/core"));
    assert.ok(hrefs.includes("https://effect.website"));
  });

  it("preserves a hash on a rewritten inter-doc link", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n[rpc](../reference/core.md#boundaryrpc)\n`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    assert.equal(find(doc.tree, "a")?.properties["href"], "/docs/reference/core#boundaryrpc");
  });

  it("edge: a frontmatter-only file yields a valid model with an empty tree", async () => {
    const doc = await parseDoc(`---\ntitle: Empty\n---\n`, GUIDE_PATH, DOCS_ROOT);
    assert.equal(doc.tree.type, "root");
    assert.equal(doc.tree.children.length, 0);
    assert.equal(doc.headings.length, 0);
  });

  it("edge: a code block with no language renders as a plain block without error", async () => {
    const doc = await parseDoc(
      `---\ntitle: T\n---\n\n\`\`\`\nplain text\n\`\`\`\n`,
      GUIDE_PATH,
      DOCS_ROOT,
    );
    const pre = find(doc.tree, "pre");
    assert.ok(pre, "expected a <pre> element");
    assert.ok(textOf(pre as HastNode).includes("plain text"));
  });
});
