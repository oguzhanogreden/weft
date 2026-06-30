/**
 * Landing page (`/`).
 *
 * The marketing home: states Weft's value proposition and proves it with a live
 * `reactive-counter` demo. Hand-authored (not markdown-sourced), minimal technical
 * aesthetic. Uses the document shell but **not** the `DocsShell` (no sidebar/TOC).
 * The code teaser is highlighted at build time via `virtual:weft-home-snippet` and
 * rendered through the shared `renderHast` → `CodeBlock` path.
 */

import { h } from "@weftui/core";
import type { Node, Renderable } from "@weftui/core";
import { Router } from "@weftui/router";
import { tree as snippetTree } from "virtual:weft-home-snippet";
import { ReactiveCounter } from "../demos/reactive-counter";
import { renderHast } from "../lib/render-hast";

/** Repo URL for GitHub links. */
const REPO_URL = "https://github.com/stefvw93/weft";
/** Primary CTA target. */
const GETTING_STARTED = "/docs/guides/getting-started";

/** The differentiators row content. */
const DIFFERENTIATORS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "No virtual DOM",
    body: "Streams update the DOM directly — no diffing, no reconciliation.",
  },
  {
    title: "No JSX, no plugins",
    body: "Plain h.* calls; components are functions you call. No build-time transform.",
  },
  {
    title: "Effect-native",
    body: "Every node is an Effect<…, E, R> — error and requirement channels flow through the tree.",
  },
  {
    title: "Flash-free SSR",
    body: "Server and client render identical trees; hydrate() resumes reactivity in place.",
  },
];

/** Hero: tagline, value prop, primary + GitHub CTAs. */
function Hero(): Renderable {
  return h.section({ class: "home-hero" }, [
    h.h1({ class: "home-hero__tagline" }, "Reactive UI, woven from Effect."),
    h.p(
      { class: "home-hero__lead" },
      "Weft is an Effect-native reactive DOM library — streams drive every update, on the server and in the browser, with no virtual DOM and no JSX.",
    ),
    h.div({ class: "home-hero__cta" }, [
      h.a({ href: GETTING_STARTED, class: "home-btn home-btn--primary" }, "Get started"),
      h.a({ href: REPO_URL, class: "home-btn", target: "_blank", rel: "noreferrer" }, "GitHub"),
    ]),
  ]);
}

/** Live hero demo: the real reactive-counter, interactive after hydrate. */
function LiveDemo(): Renderable {
  return h.section({ class: "home-demo" }, [
    h.div({ class: "home-demo__label" }, "Live — click to increment"),
    ReactiveCounter(),
  ]);
}

/** Differentiators row. */
function Differentiators(): Renderable {
  return h.section(
    { class: "home-diffs" },
    DIFFERENTIATORS.map((item) =>
      h.div({ class: "home-diff" }, [
        h.h3({ class: "home-diff__title" }, item.title),
        h.p({ class: "home-diff__body" }, item.body),
      ]),
    ),
  );
}

/** Annotated code teaser, highlighted at build time. */
function CodeTeaser(): Renderable {
  return h.section({ class: "home-teaser" }, [
    h.h2({ class: "home-teaser__heading" }, "A component is a function. State is a stream."),
    h.div({ class: "home-teaser__code" }, renderHast(snippetTree)),
  ]);
}

/** Footer: links + early-development note. */
function Footer(): Renderable {
  return h.footer({ class: "home-footer" }, [
    h.nav({ class: "home-footer__links" }, [
      h.a({ href: GETTING_STARTED }, "Docs"),
      h.a({ href: "/api/core" }, "API"),
      h.a({ href: REPO_URL, target: "_blank", rel: "noreferrer" }, "GitHub"),
    ]),
    h.p({ class: "home-footer__note" }, "Weft is in early development. APIs may change."),
  ]);
}

/** The landing page component (no props; full-width, no DocsShell). */
export const HomePage = (): Node =>
  h.div({ class: "home" }, [Hero(), LiveDemo(), Differentiators(), CodeTeaser(), Footer()]);

/** The `/` route. */
export const Home = Router.route("", { component: HomePage });
