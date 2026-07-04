# Scroll reset on navigation — Specification

## Overview & Purpose

Client SPA navigation moves the URL and swaps the outlet, but the browser does
**not** reset the window scroll position on a History `pushState`/`replaceState`
(unlike a full document load). So navigating from deep in a long page to a
different route leaves the viewport at the previous scroll offset — the user lands
mid-page instead of at the top. This is a real usability bug.

This spec brings Weft's router in line with mature routers (Next App Router,
TanStack Router, React Router): a client navigation whose **path** changes resets
scroll to the top of the page; query-only changes and browser back/forward
(popstate) do **not** reset — the latter is left to the browser's native
`history.scrollRestoration` so back/forward restores the prior offset.

The change is router-local: the navigation core `commitTo`
(`src/client/router-live.ts`) is the single choke point through which every client
navigation and popstate resync flows. No public API changes.

## Behavior

### Scroll reset

- **AC-S1 (path-change push resets scroll).** On a client navigation
  (`Router.navigate` / the link interceptor / `push` / `replace`) whose committed
  path (the portion before `?`) **differs** from the previously committed path, the
  window scrolls to the top (`window.scrollTo(0, 0)`) at commit.
- **AC-S2 (query-only nav preserves scroll).** A navigation that keeps the same
  path and changes only the query — including `setQuery` / `patchQuery`, which
  re-issue `router.navigate` on the current path — does **not** reset scroll.
- **AC-S3 (popstate preserves / defers to browser).** Browser back/forward
  (popstate) never triggers the reset. The browser's default
  `history.scrollRestoration: "auto"` restores the previous scroll offset for those
  entries; the router does not interfere.
- **AC-S4 (reset timing is height-independent).** The reset is `scrollTo(0, 0)`,
  which is valid regardless of whether the new outlet DOM has painted yet, so it is
  issued synchronously at commit (the outlet's reactive swap happens on the next
  tick). No scroll-to-element or scroll-restore is performed, so no post-render
  measurement is needed.
- **AC-S5 (server unaffected).** The reset lives only in the client router layer
  (`router-live.ts`); the server router (`server/router-server.ts`) is untouched and
  needs no `window` guard.

## Scope

- **In scope:** reset window scroll to top on a path-changing client push/replace
  navigation.
- **Out of scope / non-goals:**
  - **Hash/anchor scrolling.** The link interceptor already strips hashes and lets
    same-document / hash-only navigations fall through to the browser
    (`link.ts:72-77`); router URLs (`match.url`) are `path + search` only, so
    scroll-to-`#anchor` is browser-native and not the router's concern.
  - **Manual scroll restoration on back/forward.** Left to the browser's default
    `scrollRestoration: "auto"` (AC-S3). No `scrollRestoration: "manual"` + saved
    per-entry offset machinery.
  - **Per-navigation opt-out.** No new `NavigateOptions` field; the behavior is
    hardwired. An option can be added later if a concrete need appears.
  - **Scrolling a nested scroll container** (e.g. a scrollable content pane rather
    than the window). Only the window is reset.

## TDD step records

- **/mock — not applicable.** No new or changed exported signature/type surface;
  the fix is internal to `commitTo`. Nothing to mock.
- **/type-tests — not applicable.** No type-level surface (no new API, no generic
  or union changes).

## Acceptance criteria (summary)

- **AC1** Path-changing push/replace navigation resets window scroll to top (AC-S1).
- **AC2** Query-only navigation (incl. `setQuery`/`patchQuery`) preserves scroll
  (AC-S2).
- **AC3** popstate (back/forward) never resets; browser default restores (AC-S3).
- **AC4** The reset is a synchronous `scrollTo(0, 0)` at commit; no post-render
  timing needed (AC-S4); server render is unaffected (AC-S5).

## Test plan (spec → mock → type-tests → unit → e2e)

- **Mock / type-tests:** not applicable (recorded above).
- **Unit** (`src/client/router-live.test.ts`, JSDOM): spy `window.scrollTo` and
  assert — a path-change push calls `scrollTo(0, 0)` (AC-S1); a query-only nav on
  the same path does **not** call it (AC-S2); a popstate resync does **not** call it
  (AC-S3). Verify the first navigation from the initial URL to a different path
  resets, and a no-op navigation to the identical URL does not.
- **Browser e2e** (`website/src/__tests__/doc-navigation.browser.test.ts` or the
  `examples/router-ssr` browser suite): scroll the page down, click a link to a
  different route, assert `window.scrollY === 0` after the render tick.
