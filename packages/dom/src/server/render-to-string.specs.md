# renderToString — Specification

## Overview

`renderToString` serializes an Effect-infused JSX tree (`JSXNode`) into an HTML
string. It is the server-side counterpart to the client DOM renderer
(`render-core.ts` + `dom.ts`) and is intended to produce output that is
isomorphic with what the client renderer would create in the browser.

## Scope of this spec

Serialization of **standard HTML elements** (string `type`): the open tag with
attributes, children, and the close tag. Primitives, streams/effects, iterables,
and fragments are handled by earlier branches of the same function.

## Design notes (divergence from React)

- **Reactive attribute values.** Unlike React, an attribute value may be a
  `Stream` or `Effect` (`AttributeValue<T>`). Because SSR is one-shot, such a
  value is collapsed to its **last** emission via `Stream.runLast` (mirroring how
  reactive children are rendered); an empty stream omits the attribute.
- **No prop renaming.** Prop names are emitted verbatim. The client's
  property-vs-attribute decision relies on the live DOM and cannot run on the
  server, so every non-special prop becomes an attribute.
- **Minimal boolean handling.** Only `typeof === "boolean"` is special-cased
  (matching the client), not React's overloaded/booleanish/numeric tables.

## Acceptance criteria

### Text content

- AC-T1: String/number/bigint primitives are escaped before output (`< > & " '`).

### Elements

- AC-E1: A string-typed element renders as `<type ...attrs>children</type>`.
- AC-E2: An element with no children renders as `<type></type>`.
- AC-E3: Children are rendered recursively (nested elements, arrays, fragments)
  and concatenated.

### Attributes

- AC-A1: String/number values render as ` name="value"` with the value escaped,
  always double-quoted.
- AC-A2: Boolean `true` renders as ` name=""`; boolean `false` is omitted.
- AC-A3: `null` and `undefined` values are omitted.
- AC-A4: `children`, `ref`, and event-handler props (`on` + lowercase letter,
  per `isEventHandler`) are skipped.
- AC-A5: Attribute names are emitted as-is (no renaming/normalization/validation).

### Reactive attributes

- AC-R1: A `Stream` attribute value resolves to its last emission.
- AC-R2: An `Effect` attribute value resolves to its success value.
- AC-R3: An empty stream omits the attribute.

### Style

- AC-S1: A string `style` renders as ` style="<escaped string>"`.
- AC-S2: An object `style` renders camelCase keys as kebab-case, joined with
  `"; "`, inside one escaped ` style="..."`.
- AC-S3: `null`/`undefined` object style values are skipped; an empty object
  produces no `style` attribute.
- AC-S4: Stream/Effect style values (whole prop or per-property) resolve to their
  last emission.

### Void elements

- AC-V1: Void elements (`area, base, br, col, embed, hr, img, input, link, meta,
param, source, track, wbr`) render with no closing tag.
- AC-V2: Children of void elements are ignored.
