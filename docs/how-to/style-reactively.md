---
title: Style Reactively
order: 10
section: how-to
description: Drive inline styles from streams (a single property, or a whole style object) so the DOM updates in place with CSS transitions.
---

# Style Reactively

**Goal:** animate or react to state in an element's inline style without re-rendering.

The `style` prop accepts the [`Source`](../explanation/reactive-primitives.md) vocabulary at either level: a single property's value, or the whole object. CSS `transition` composes naturally, because a stream emission patches the existing DOM node in place.

```typescript
import { h } from "@weftui/core";
import { Schedule, Stream } from "effect";

const AnimatedHue = () => {
  const hue = Stream.iterate(0, (h) => (h + 2) % 360).pipe(
    Stream.schedule(Schedule.spaced("50 millis")),
  );

  return h.div(
    {
      class: "demo-box",
      style: {
        // one property is reactive; the rest are static
        backgroundColor: Stream.map(hue, (h) => `hsl(${h}, 70%, 60%)`),
        transition: "background-color 0.05s",
      },
    },
    "Hue",
  );
};
```

## Per-property streams

Give one or more keys a `Stream` value and leave the rest as plain strings. Each reactive key subscribes independently, so two properties can animate off unrelated sources on the same element:

```typescript
const size = Stream.iterate(100, (s) => (s >= 150 ? 100 : s + 10)).pipe(
  Stream.schedule(Schedule.spaced("200 millis")),
);

h.div({
  style: {
    width: Stream.map(size, (s) => `${s}px`),
    height: Stream.map(size, (s) => `${s}px`),
    transition: "width 0.2s, height 0.2s",
  },
});
```

A key without a stream stays static: an ordinary `style: { backgroundColor: "#667eea" }` never updates.

## Whole-object streams

Give `style` itself a `Stream` that emits complete style objects. Each emission replaces every property on the element, so it's the right shape for changes that move several properties together:

```typescript
const theme = Stream.make(
  { backgroundColor: "#667eea", transform: "scale(1)" },
  { backgroundColor: "#764ba2", transform: "scale(1.1)" },
).pipe(Stream.schedule(Schedule.spaced("1 second")), Stream.forever);

h.div({
  // fold the static `transition` into every emitted object: the renderer
  // clears and resets all style properties on each emission, so a sibling
  // key can't survive alongside it. Spreading `theme` into a style object
  // literal doesn't work either, since that copies the Stream's own fields,
  // not the values it emits.
  style: Stream.map(theme, (s) => ({ ...s, transition: "all 0.3s ease" })),
});
```

## Reactive classes

`Props.cx` (from `@weftui/dom`) builds a class string from static names and `{ className: condition }` records, where a condition may be a stream:

```typescript
import { h } from "@weftui/core";
import { Props } from "@weftui/dom";

h.div({ class: Props.cx("demo-box", { "demo-box--active": isActiveStream }) });
```

See [Compose Behavior and Markup](./compose-behavior-and-markup.md) for merging `class` across two prop bags.

## Notes

- **Property names are camelCase** (`backgroundColor`, `boxShadow`), the same keys as the DOM `style` object.
- **CSS transitions just work.** A stream emission patches the DOM node directly (no re-render), so the browser applies `transition` as it would for any style mutation.
- **Pace with `Schedule`.** `Stream.iterate`/`Stream.make`, paced by `Stream.schedule(Schedule.spaced(…))` and looped with `Stream.forever`, is the idiom for time-based style animation:

```typescript
Stream.iterate(0, (n) => n + 1).pipe(
  Stream.schedule(Schedule.spaced("100 millis")),
  Stream.forever,
);
```

Combine with any Effect timing you like.

## Complete example

A page with one per-property demo (hue cycling) and one whole-object demo (theme switch), mounted into an empty `#root`. This is the whole file set, copy/paste runnable in a `vite` + `@weftui/core` project.

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weft reactive styles demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```typescript
// src/app.ts
/**
 * Reactive styles demo: a per-property hue cycle and a whole-object theme
 * switch. Side-effect-free (no mount call), so `main.ts` and any test can
 * import `App` directly.
 */
import { h } from "@weftui/core";
import { Schedule, Stream } from "effect";

const AnimatedHue = () => {
  const hue = Stream.iterate(0, (h) => (h + 2) % 360).pipe(
    Stream.schedule(Schedule.spaced("50 millis")),
  );

  return h.div(
    {
      style: {
        backgroundColor: Stream.map(hue, (h) => `hsl(${h}, 70%, 60%)`),
        transition: "background-color 0.05s",
        padding: "1rem",
      },
    },
    "Hue",
  );
};

const ThemeSwitch = () => {
  const theme = Stream.make(
    { backgroundColor: "#667eea", transform: "scale(1)" },
    { backgroundColor: "#764ba2", transform: "scale(1.1)" },
  ).pipe(Stream.schedule(Schedule.spaced("1 second")), Stream.forever);

  return h.div(
    {
      style: Stream.map(theme, (s) => ({ ...s, transition: "all 0.3s ease", padding: "1rem" })),
    },
    "Theme",
  );
};

export const App = () => h.div([AnimatedHue(), ThemeSwitch()]);
```

```typescript
// src/main.ts
/**
 * Browser entry: mounts the reactive styles demo into `#root`.
 */
import { WeftApp } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}

const app = WeftApp.make();
void Effect.runPromise(WeftApp.mount(app, App(), root));
```

## See also

- [Reactive Primitives](../explanation/reactive-primitives.md): reactive style props and the `Source` vocabulary
- [Compose Behavior and Markup](./compose-behavior-and-markup.md): `Props.cx` and merging `class` across two prop bags
- [examples/reactive-styles](../../examples/reactive-styles): per-property and whole-object stream styles with CSS transitions
