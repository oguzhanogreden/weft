/**
 * Docs shell layout.
 *
 * The persistent chrome around every documentation page: a top bar, a left sidebar
 * nav, the center content (the router outlet), a right "On this page" TOC, and a
 * prev/next footer. Authored as a `Router.layout` **component** so it stays mounted
 * across doc-to-doc navigations — the route phase wraps it with the doc/api routes
 * via `Router.layout({ component: DocsShell }, [...])`.
 *
 * The active link, TOC, and prev/next all derive from the **current route path**,
 * read reactively from `Router.currentMatch` so a navigation updates them in place
 * without remounting the shell. Internal links are plain same-origin paths, which
 * `RouterLive` intercepts for SPA navigation on the client.
 */

import { Component, h } from "@weftui/core";
import type { Renderable } from "@weftui/core";
import { Router } from "@weftui/router";
import { Stream } from "effect";
import { liveDocs } from "../lib/docs-live";
import type { DocsService } from "../lib/docs-service";
import type { DocHeading } from "../lib/markdown-loader";
import type { NavGroup, NavNeighbours } from "../lib/nav";

/** Repo URL for the top-bar GitHub link. */
const REPO_URL = "https://github.com/stefvw93/weft";
/** Version label shown in the top bar. */
const VERSION = "v0.0.0";

/** Strips the query string from a normalized request URL, yielding the pathname. */
function pathnameOf(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/** The static top bar: wordmark, version, GitHub link, and an inert search placeholder. */
export function TopBar(): Renderable {
  return h.header({ class: "docs-topbar" }, [
    h.a({ href: "/", class: "docs-topbar__brand" }, "Weft"),
    h.span({ class: "docs-topbar__version" }, VERSION),
    h.div({ class: "docs-topbar__spacer" }),
    h.input({
      type: "search",
      class: "docs-topbar__search",
      placeholder: "Search (coming soon)",
      disabled: true,
      "aria-label": "Search (coming soon)",
    }),
    h.a(
      { href: REPO_URL, class: "docs-topbar__github", target: "_blank", rel: "noreferrer" },
      "GitHub",
    ),
  ]);
}

/** Renders the grouped sidebar nav, marking the link that matches `activePath`. */
export function renderSidebar(groups: readonly NavGroup[], activePath: string): Renderable {
  return h.nav(
    { class: "docs-nav", "aria-label": "Documentation" },
    groups.map((group) =>
      h.div({ class: "docs-nav__group" }, [
        h.h3({ class: "docs-nav__label" }, group.label),
        h.ul(
          { class: "docs-nav__list" },
          group.links.map((link) => {
            const active = link.path === activePath;
            return h.li([
              h.a(
                {
                  href: link.path,
                  class: active ? "docs-nav__link is-active" : "docs-nav__link",
                  ...(active ? { "aria-current": "page" as const } : {}),
                },
                link.title,
              ),
            ]);
          }),
        ),
      ]),
    ),
  );
}

/** Renders the "On this page" TOC from a doc's h2–h3 headings, or nothing if there are none. */
export function renderToc(headings: readonly DocHeading[]): Renderable {
  const items = headings.filter((heading) => heading.depth <= 3);
  if (items.length === 0) return null;
  return h.nav({ class: "docs-toc", "aria-label": "On this page" }, [
    h.div({ class: "docs-toc__label" }, "On this page"),
    h.ul(
      { class: "docs-toc__list" },
      items.map((item) =>
        h.li([
          h.a(
            { href: `#${item.id}`, class: `docs-toc__link docs-toc__link--h${item.depth}` },
            item.text,
          ),
        ]),
      ),
    ),
  ]);
}

/** Renders the prev/next footer; each side is omitted at the ends of the doc list. */
export function renderPrevNext(neighbours: NavNeighbours): Renderable {
  const { prev, next } = neighbours;
  return h.nav({ class: "docs-prevnext", "aria-label": "Pagination" }, [
    prev === undefined
      ? h.span({ class: "docs-prevnext__slot" })
      : h.a({ href: prev.path, class: "docs-prevnext__slot docs-prevnext__prev" }, [
          h.span({ class: "docs-prevnext__dir" }, "Previous"),
          h.span({ class: "docs-prevnext__title" }, prev.title),
        ]),
    next === undefined
      ? h.span({ class: "docs-prevnext__slot" })
      : h.a({ href: next.path, class: "docs-prevnext__slot docs-prevnext__next" }, [
          h.span({ class: "docs-prevnext__dir" }, "Next"),
          h.span({ class: "docs-prevnext__title" }, next.title),
        ]),
  ]);
}

/** Headings for the doc at a route pathname (empty if none/unknown). */
function headingsForPath(path: string, get: DocsService["get"]): readonly DocHeading[] {
  const parts = path.split("/").filter((p) => p.length > 0);
  const doc =
    parts[0] === "api" && parts[1] !== undefined
      ? get("api", parts[1])
      : parts[0] === "docs" && parts[1] !== undefined && parts[2] !== undefined
        ? get(parts[1], parts[2])
        : undefined;
  return doc?.headings ?? [];
}

/**
 * The docs shell component. Reads the live route path from `Router.currentMatch` and
 * drives the sidebar highlight, TOC, and prev/next reactively from the `liveDocs`
 * model, while the outlet holds the page content. Wrap with
 * `Router.layout({ component: DocsShell }, [routes])`.
 */
export const DocsShell = Component.gen(function* () {
  const router = yield* Router;
  const outlet = yield* Router.Outlet;
  const path = Stream.map(router.currentMatch.changes, (match) => pathnameOf(match.url));

  return yield* h.div({ class: "docs-shell" }, [
    TopBar(),
    h.div({ class: "docs-shell__body" }, [
      h.aside({ class: "docs-shell__sidebar" }, [
        Stream.map(path, (current) => renderSidebar(liveDocs.nav.groups, current)),
      ]),
      h.main({ class: "docs-shell__content" }, [
        h.article({ class: "docs-content" }, [outlet]),
        Stream.map(path, (current) => renderPrevNext(liveDocs.nav.findNav(current))),
      ]),
      h.aside({ class: "docs-shell__toc" }, [
        Stream.map(path, (current) => renderToc(headingsForPath(current, liveDocs.get))),
      ]),
    ]),
  ]);
});
