# Reactive Styles

## Overview

This example demonstrates how to use streams for dynamic styling in effect-ui. Styles can be static strings, objects with stream properties, or entire style streams for complete style replacement.

## Problem

Traditional React-style apps require state management and re-renders for style changes. CSS animations work for simple cases, but complex dynamic styles often need JavaScript control.

## Solution

effect-ui supports reactive styles through streams — any CSS property or the entire style object can be a `Stream`:

```typescript
import { h } from "@effect-ui/core";
import { Stream, Schedule } from "effect";

// Individual property as stream
h.div({
  style: {
    backgroundColor: colorStream,
    width: widthStream,
  },
});

// Entire style object as stream
h.div({ style: styleObjectStream });

// Mixed static and reactive (spread a stream into the style object)
h.div({
  style: {
    ...styleObjectStream,
    transition: "all 0.3s", // static
  },
});
```

## How It Works

1. Individual CSS properties can be streams that emit new string/number values
2. The entire style object can be a stream for coordinated, multi-property changes
3. Spread syntax (`...stream`) inside a style object merges each emitted object with the static properties
4. CSS transitions work naturally — stream updates trigger transitions just like direct style mutations
5. Multiple stream properties on one element are subscribed independently

## Benefits

- **Fine-grained control**: Animate individual properties independently
- **CSS transitions**: Works seamlessly with CSS `transition` properties
- **Coordinated changes**: Use style object streams for synchronized updates
- **Effect integration**: Combine with `Effect.delay`, `Schedule`, and other timing primitives
- **No re-renders**: Updates happen directly on DOM nodes

## Usage Patterns

### Individual Property Stream

```typescript
const hueStream = Stream.iterate(0, (hue) => (hue + 2) % 360).pipe(
  Stream.schedule(Schedule.spaced("50 millis")),
);

h.div({
  style: {
    backgroundColor: Stream.map(hueStream, (hue) => `hsl(${hue}, 70%, 60%)`),
    transition: "background-color 0.05s",
  },
});
```

### Style Object Stream

```typescript
const styleStream = Stream.make(
  { backgroundColor: "red", transform: "scale(1)" },
  { backgroundColor: "blue", transform: "scale(1.1)" },
).pipe(Stream.schedule(Schedule.spaced("1 second")));

h.div({ style: styleStream });
```

### Combined Static and Reactive

```typescript
h.div({
  style: {
    ...dynamicStream, // reactive: spread each emitted object
    position: "absolute", // static
    transition: "all 0.3s",
  },
});
```

### Opacity Pulse

```typescript
const opacityStream = Stream.make(1, 0.5).pipe(
  Stream.schedule(Schedule.spaced("800 millis")),
  Stream.forever,
);

h.div({
  style: {
    opacity: opacityStream,
    transition: "opacity 0.4s ease-in-out",
  },
});
```

## When to Use

- Real-time visualizations and data displays
- Interactive animations responding to user input
- Theme switching with smooth transitions
- Progress indicators and loading states
- Any style that changes based on async data
