import * as assert from "node:assert/strict";
import { h } from "@weftui/core";
import { describe, it } from "vite-plus/test";
import { renderString } from "../__tests__/ssr";
import type { DocHeading } from "../lib/markdown-loader";
import type { NavGroup, NavNeighbours } from "../lib/nav";
import { TopBar, renderPrevNext, renderSidebar, renderToc } from "./docs-shell";

const groups: NavGroup[] = [
  {
    section: "tutorial",
    label: "Tutorial",
    links: [
      { title: "Getting Started", path: "/docs/tutorial/getting-started", section: "tutorial" },
    ],
  },
  {
    section: "how-to",
    label: "How-to",
    links: [{ title: "Routing", path: "/docs/how-to/add-routing", section: "how-to" }],
  },
  {
    section: "reference",
    label: "Reference",
    links: [{ title: "@weftui/core", path: "/docs/reference/core", section: "reference" }],
  },
];

const html = (node: Parameters<typeof renderString>[0]) => renderString(h.div({}, [node]));

describe("docs-shell render helpers", () => {
  it("AC1: the sidebar renders all groups and links in order", async () => {
    const out = await html(renderSidebar(groups, "/docs/tutorial/getting-started"));
    assert.match(out, /Tutorial[\s\S]*How-to[\s\S]*Reference/);
    assert.match(out, /Getting Started[\s\S]*Routing[\s\S]*@weftui\/core/);
    assert.match(out, /href="\/docs\/how-to\/add-routing"/);
    assert.match(out, /href="\/docs\/reference\/core"/);
  });

  it("AC2: the link matching the current route is marked active", async () => {
    const out = await html(renderSidebar(groups, "/docs/how-to/add-routing"));
    // Active state is asserted via aria-current="page" (the stable hook), not a class.
    assert.match(out, /aria-current="page"[^>]*>Routing</);
    // Exactly one link is active, and the non-active link carries no aria-current.
    assert.equal((out.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(out, /docs-nav-link[^>]*>Getting Started</);
  });

  it("AC3: the TOC lists h2–h3 headings with working anchor links", async () => {
    const headings: DocHeading[] = [
      { depth: 2, id: "install", text: "Install" },
      { depth: 3, id: "first-component", text: "First component" },
      { depth: 4, id: "too-deep", text: "Too deep" },
    ];
    const out = await html(renderToc(headings));
    assert.match(out, /On this page/);
    assert.match(out, /href="#install"[^>]*>Install</);
    assert.match(out, /href="#first-component"/);
    assert.equal(out.includes("too-deep"), false); // h4 excluded
  });

  it("AC3 edge: a doc with no h2–h3 headings renders no TOC", () => {
    assert.equal(renderToc([]), null);
    assert.equal(renderToc([{ depth: 4, id: "x", text: "X" }]), null);
  });

  it("AC4: the footer renders prev/next links", async () => {
    const neighbours: NavNeighbours = {
      current: { title: "Routing", path: "/docs/how-to/add-routing", section: "how-to" },
      prev: {
        title: "Getting Started",
        path: "/docs/tutorial/getting-started",
        section: "tutorial",
      },
      next: { title: "@weftui/core", path: "/docs/reference/core", section: "reference" },
    };
    const out = await html(renderPrevNext(neighbours));
    assert.match(
      out,
      /prevnext-prev[^>]*href="\/docs\/tutorial\/getting-started"|href="\/docs\/tutorial\/getting-started"[^>]*prevnext-prev/,
    );
    assert.match(out, /Getting Started/);
    assert.match(out, /Next/);
    assert.match(out, /@weftui\/core/);
  });

  it("AC4 edge: ends of the list omit the missing neighbour", async () => {
    const out = await html(
      renderPrevNext({
        next: { title: "Routing", path: "/docs/how-to/add-routing", section: "how-to" },
      }),
    );
    assert.equal(out.includes("prevnext-prev"), false);
    assert.match(out, /prevnext-next/);
  });

  it("top bar links to home and GitHub", async () => {
    const out = await html(TopBar());
    // Brand is asserted via its home link + text, not a class.
    assert.match(out, /href="\/"[^>]*>Weft</);
    assert.match(out, /href="https:\/\/github.com\/stefvw93\/weft"/);
  });
});
