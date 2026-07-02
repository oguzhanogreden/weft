import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import type { DocModel } from "./markdown-loader";
import { buildNav } from "./nav";

/** Minimal `DocModel` fixture; only the fields `buildNav` reads are meaningful. */
function doc(section: string, slug: string, title: string, order: number): DocModel {
  return {
    slug,
    category: section,
    path: `${section}/${slug}`,
    frontmatter: { title, order, section },
    headings: [],
    tree: { type: "root", children: [] },
  };
}

describe("buildNav", () => {
  it("AC1: produces one group per section in the fixed order tutorial → how-to → explanation → reference", () => {
    const { groups } = buildNav([
      doc("reference", "core", "@weftui/core", 1),
      doc("tutorial", "getting-started", "Getting Started", 1),
      doc("explanation", "combinator-api", "The Combinator API", 1),
      doc("how-to", "author-components", "Author Components", 1),
    ]);
    assert.deepEqual(
      groups.map((g) => g.section),
      ["tutorial", "how-to", "explanation", "reference"],
    );
    assert.deepEqual(
      groups.map((g) => g.label),
      ["Tutorial", "How-to", "Explanation", "Reference"],
    );
  });

  it("AC2: links within a group are ordered by order, then title", () => {
    const { groups } = buildNav([
      doc("how-to", "add-routing", "Routing", 5),
      doc("how-to", "author-components", "Author Components", 1),
      doc("how-to", "render-on-the-server", "Server-Side Rendering", 3),
    ]);
    assert.deepEqual(
      groups[0]?.links.map((l) => l.title),
      ["Author Components", "Server-Side Rendering", "Routing"],
    );
  });

  it("AC2 edge: equal order falls back to a deterministic title tie-break", () => {
    const { groups } = buildNav([doc("how-to", "b", "Beta", 2), doc("how-to", "a", "Alpha", 2)]);
    assert.deepEqual(
      groups[0]?.links.map((l) => l.title),
      ["Alpha", "Beta"],
    );
  });

  it("AC2 edge: absent order (Infinity) sorts last, tie-broken by title", () => {
    const { groups } = buildNav([
      doc("how-to", "z", "Zed", Infinity),
      doc("how-to", "a", "Apple", Infinity),
      doc("how-to", "first", "First", 1),
    ]);
    assert.deepEqual(
      groups[0]?.links.map((l) => l.title),
      ["First", "Apple", "Zed"],
    );
  });

  it("AC3: firstDocPath is the path of the first link in the first group", () => {
    const { firstDocPath } = buildNav([
      doc("reference", "core", "@weftui/core", 1),
      doc("tutorial", "getting-started", "Getting Started", 1),
    ]);
    assert.equal(firstDocPath, "/docs/tutorial/getting-started");
  });

  it("every section routes uniformly through /docs/:section/:slug", () => {
    const { groups } = buildNav([doc("reference", "router", "@weftui/router", 1)]);
    assert.equal(groups[0]?.links[0]?.path, "/docs/reference/router");
  });

  it("AC4: findNav returns the current link and its prev/next neighbours", () => {
    const { findNav } = buildNav([
      doc("tutorial", "getting-started", "Getting Started", 1),
      doc("how-to", "author-components", "Component Authoring", 1),
      doc("how-to", "add-routing", "Routing", 2),
    ]);
    const mid = findNav("/docs/how-to/author-components");
    assert.equal(mid.current?.title, "Component Authoring");
    assert.equal(mid.prev?.title, "Getting Started");
    assert.equal(mid.next?.title, "Routing");
  });

  it("AC4: neighbours are undefined at the ends of the flat list", () => {
    const { findNav, flat } = buildNav([
      doc("tutorial", "getting-started", "Getting Started", 1),
      doc("how-to", "add-routing", "Routing", 1),
    ]);
    const first = findNav(flat[0]!.path);
    assert.equal(first.prev, undefined);
    assert.equal(first.next?.title, "Routing");
    const last = findNav(flat[1]!.path);
    assert.equal(last.next, undefined);
    assert.equal(last.prev?.title, "Getting Started");
  });

  it("AC4: an unknown path yields no current/prev/next", () => {
    const { findNav } = buildNav([doc("tutorial", "getting-started", "Getting Started", 1)]);
    assert.deepEqual(findNav("/docs/tutorial/nope"), {});
  });

  it("unknown sections are appended alphabetically after the fixed order", () => {
    const { groups } = buildNav([
      doc("zebra", "z", "Zebra Doc", 1),
      doc("alpha", "a", "Alpha Doc", 1),
      doc("tutorial", "g", "Guide", 1),
    ]);
    assert.deepEqual(
      groups.map((g) => g.section),
      ["tutorial", "alpha", "zebra"],
    );
  });
});
