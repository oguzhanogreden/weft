# Weft website — design system spec (DaisyUI + Radix Colors)

## Overview & purpose

Replace the website's flat, hand-written stylesheet with a **token-driven design
system**. Today `src/app.css` (539 lines) is BEM CSS with hardcoded hex colors
repeated throughout, no design tokens, no dark mode, and — despite Tailwind v4
being installed (`@tailwindcss/vite`) — **zero utility/component usage**. Colors
cannot be themed and there is no consistent scale.

This spec introduces **DaisyUI** (semantic components) layered on the existing
Tailwind v4 pipeline, driven by **Radix Colors** (Indigo accent + Slate gray,
**dark scale only**) mapped per the Radix
[palette-composition](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)
step-role model.

Approach is **hybrid**: DaisyUI components (`btn`, `navbar`, `card`, `input`)
where they fit; bespoke **token-driven** CSS retained for the docs grid, sidebar
nav, TOC, prose typography, and code blocks. This supersedes the "dark mode —
out of scope (v1)" line in `src/specs.md`.

## Design principles

- **Radix step roles are the source of truth.** Each 12-step scale has fixed UI
  roles — do not invent contrast pairings; map by role (table below).
- **CSS-first, additive.** Tailwind v4 has no `tailwind.config`/`postcss.config`;
  DaisyUI registers via `@plugin "daisyui"` and Radix via `@import` inside
  `app.css`. No JS config files. `tailwindcss()` must stay in **both** vite
  configs (client + SSR) so new `@import`/`@plugin` resolve in the SSR build.
- **Contained blast radius.** All color/theme changes flow through `app.css`
  (dev module graph, prod manifest `css[]` → hashed `<link>`). No `server.ts`,
  entry, or build-config changes — except one `<html>` attribute in `shell.ts`
  to activate the dark theme.
- **Preserve tested class names.** `docs-topbar__brand`, `docs-nav__link`,
  `is-active`, `demo-counter__value` are asserted by tests — do not rename
  without updating the co-located `.test.ts` in the same change.

## Radix step-role → token mapping (dark scale)

Role reference (per composing-a-palette):

| Steps | Role                            |
| ----- | ------------------------------- |
| 1–2   | app / subtle backgrounds        |
| 3–5   | component bg / hover / active   |
| 6–8   | borders, separators, focus ring |
| 9–10  | solid fills / hover             |
| 11–12 | low- / high-contrast text       |

DaisyUI semantic tokens (theme `weft-dark`, Indigo + Slate):

| DaisyUI token             | Source        | Rationale                                                           |
| ------------------------- | ------------- | ------------------------------------------------------------------- |
| `--color-base-100`        | `--slate-1`   | app background                                                      |
| `--color-base-200`        | `--slate-2`   | subtle surface                                                      |
| `--color-base-300`        | `--slate-3`   | raised/hover surface                                                |
| `--color-base-content`    | `--slate-12`  | body text                                                           |
| `--color-neutral`         | `--slate-4`   | neutral surface/button                                              |
| `--color-neutral-content` | `--slate-12`  | text on neutral                                                     |
| `--color-primary`         | `--indigo-9`  | solid accent (buttons/links)                                        |
| `--color-primary-content` | `white`       | indigo-9 pairs with white                                           |
| `--color-secondary`       | `--indigo-10` | hover/secondary solid                                               |
| `--color-accent`          | `--indigo-11` | accent text/emphasis                                                |
| `--color-info`            | `--blue-9`    | semantic                                                            |
| `--color-success`         | `--green-9`   | semantic                                                            |
| `--color-warning`         | `--amber-9`   | amber-9 needs dark text → `--color-warning-content: var(--slate-1)` |
| `--color-error`           | `--red-9`     | semantic                                                            |

Bespoke CSS references raw steps directly, replacing the current hardcoded hex:

| Old hex                   | Replace with                        | Use                   |
| ------------------------- | ----------------------------------- | --------------------- |
| `#e5e5ec`, `#2a2a35`      | `var(--slate-6)` / `var(--slate-7)` | borders, separators   |
| `#8b8b96`, `#555`, `#666` | `var(--slate-11)`                   | muted text            |
| `#1f6feb`                 | `var(--indigo-11)`                  | links                 |
| `#eef4ff`                 | `var(--indigo-4)`                   | active-nav background |
| `#111`                    | `var(--slate-12)`                   | headings              |

## Technical requirements

- **Deps** (`website/package.json` devDependencies): add `daisyui` (v5),
  `@radix-ui/colors`. Install via `vp install`.
- **`app.css` structure** (in order):
  1. `@import "tailwindcss";`
  2. Radix dark scales:
     `@import "@radix-ui/colors/{slate,indigo,blue,green,amber,red}-dark.css";`
  3. `@plugin "daisyui";` + `@plugin "daisyui/theme" { name: "weft-dark";
default: true; color-scheme: dark; … }` (semantic mapping above).
  4. `@theme { --color-slate-1..12, --color-indigo-1..12 … }` exposing raw steps
     as utilities (`border-slate-6`, `text-indigo-11`).
  5. Bespoke component CSS (docs grid, nav, TOC, prose, code-block, demo, home) —
     structure kept, every hex swapped for a token.
- **Radix dark caveat:** `*-dark.css` scope their vars to `.dark, .dark-theme`
  (not `:root`). `<html>` must therefore carry `class="dark"`. Dark-only still
  needs this one attribute.
- **`shell.ts` (`shell.ts:55`):** add `class: "dark"` and `"data-theme":
"weft-dark"` to the `h.html` props. No other shell edits.
- **Components (hybrid):**
  - `routes/home.ts` — CTAs → `btn btn-primary` / `btn btn-outline`;
    differentiator cards → `card bg-base-200`; footer tokenized.
  - `layouts/docs-shell.ts` — top bar → DaisyUI `navbar`, **keep
    `docs-topbar__brand` on the wordmark**; search → `input input-bordered
input-sm`; GitHub link → `btn btn-ghost btn-sm`; sidebar nav stays custom
    (**keep `docs-nav__link` / `is-active`**), recolored only.
  - `components/code-block.ts`, `demos/*` — no markup change; recolor via
    `app.css`. Copy button → `btn btn-xs btn-ghost` (optional).
- Keep Shiki `github-dark` for code (already dark, harmonizes with slate).

## Acceptance criteria

- AC1: `<html>` renders with `class="dark" data-theme="weft-dark"`; the
  computed page background resolves to `--slate-1` (dark).
- AC2: `app.css` contains **no** hardcoded hex color literals in the bespoke
  component rules — every color is `var(--slate-*)` / `var(--indigo-*)` or a
  DaisyUI semantic token. (Shiki-baked inline token colors on `<span>`s are
  exempt — they come from the highlighter, not `app.css`.)
- AC3: DaisyUI is active — `btn`/`card`/`navbar`/`input` classes produce styled
  output; landing CTAs are `btn btn-primary` (indigo solid, white text).
- AC4: Semantic tokens map to the Radix steps in the table; primary = indigo-9,
  base-100 = slate-1, borders = slate-6/7, links = indigo-11.
- AC5: `warning` uses dark foreground (`--color-warning-content: var(--slate-1)`)
  so amber-9 fills remain legible.
- AC6: Tested class names preserved: `docs-topbar__brand`, `docs-nav__link`,
  `is-active`, `demo-counter__value` still present (or their `.test.ts` updated
  in the same change).
- AC7: No hydration mismatch, no unstyled flash — server and client trees
  identical (theme comes from CSS + a static `<html>` attribute).
- AC8: `vp run check`, `vp run test`, `vp run test:browser` all pass.
- AC9: Prod parity — `vp run build` + `NODE_ENV=production node server.ts`
  serve the hashed `app.css` (manifest `css[]`) with theme identical to dev.

## Critical files

- `website/package.json` — add `daisyui`, `@radix-ui/colors`
- `website/src/app.css` — token layers + full recolor (primary surface)
- `website/src/layouts/shell.ts` — `class="dark"` + `data-theme` on `<html>`
- `website/src/layouts/docs-shell.ts` — navbar/input/button, pinned class names
- `website/src/routes/home.ts` — btn/card components
- `website/src/components/code-block.ts` — optional copy-button component

## Out of scope

- Light theme + theme toggle (Radix light scales ready to add later).
- Client-side search (still inert placeholder).
- Restyling Shiki token colors (keep `github-dark`).

## Verification

1. `vp install`.
2. `cd website && vp run dev` → `http://localhost:3000`: dark theme, indigo
   accents, slate surfaces, docs grid + TOC + code readable, no flash.
3. `vp run check` (repo root — packs first) → clean.
4. `vp run test` → node/jsdom green (incl. `docs-shell.test.ts` class asserts).
5. `vp run test:browser` → `website.browser.test.ts` green (counter, hydration).
6. `cd website && vp run build && NODE_ENV=production node server.ts` → prod
   parity, hashed CSS linked.
7. `graphify update .` to refresh the knowledge graph.
