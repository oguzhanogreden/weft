# `@effect-ui/jsx-runtime` — Runtime Entry Points

## Overview

`@effect-ui/jsx-runtime` provides the JSX transform functions and global `JSX`
namespace augmentation for effect-ui. It targets TypeScript's **automatic** JSX
runtime (`jsxImportSource: "@effect-ui/jsx-runtime"`) while remaining usable via
the classic transform (`jsxFactory: "jsx"` + `jsxInject`) as the playground does.

## Purpose

Transform JSX syntax into the renderer-agnostic node shape
`{ type, props }` consumed by `@effect-ui/dom` and other renderers, regardless
of whether the consumer's bundler runs the automatic runtime in production
(`jsx`/`jsxs`) or development (`jsxDEV`) mode.

## Public API

- `jsx(type, props, ...children)` — element factory. Supports both the
  automatic transform (children in `props.children`) and the classic transform
  (children as variadic args).
- `jsxs` — alias of `jsx`; emitted by the automatic runtime for static
  children arrays.
- `jsxDEV(type, props)` — development variant emitted by the automatic runtime
  in dev mode. Delegates to `jsx`; dev-only metadata args (`key`,
  `isStaticChildren`, `source`, `self`) are ignored.
- `Fragment` / `FRAGMENT` — re-exported from `@effect-ui/html-types`.
- `global JSX` namespace: `JSX.Element` and `JSX.IntrinsicElements`.

## Export Subpaths

The package exposes three subpaths, all pointing at the same dist bundle:

- `.` — direct imports (`import { jsx } from "@effect-ui/jsx-runtime"`).
- `./jsx-runtime` — automatic runtime, production (resolves `jsx`, `jsxs`,
  `Fragment`).
- `./jsx-dev-runtime` — automatic runtime, development (resolves `jsxDEV`,
  `Fragment`).

## Acceptance Criteria

1. The automatic runtime resolves in **production** mode: importing
   `jsx`/`jsxs`/`Fragment` from `@effect-ui/jsx-runtime/jsx-runtime` succeeds.
2. The automatic runtime resolves in **development** mode: importing
   `jsxDEV`/`Fragment` from `@effect-ui/jsx-runtime/jsx-dev-runtime` succeeds
   (this is what `vp test` exercises when transforming `.tsx` test files).
3. `jsxDEV(type, props)` produces the same `{ type, props }` node as
   `jsx(type, props)` for equivalent input.
4. The classic transform path (playground `jsxInject`) remains unaffected.
