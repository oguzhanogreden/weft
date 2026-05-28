/**
 * Recipe: Reactive Styles
 *
 * This recipe demonstrates how to use streams for dynamic styling in effect-ui.
 * Styles can be static strings, objects with stream properties, or entire
 * style streams for complete style replacement.
 */

import { h } from "@effect-ui/core";
import { mount } from "@effect-ui/dom/client";
import { Effect, Schedule, Stream } from "effect";

// ============================================================================
// Example 1: Individual Style Properties as Streams
// ============================================================================

const AnimatedHue = () => {
  const hueStream = Stream.iterate(0, (hue) => (hue + 2) % 360).pipe(
    Stream.schedule(Schedule.spaced("50 millis")),
  );

  const backgroundStream = Stream.map(hueStream, (hue) => `hsl(${hue}, 70%, 60%)`);

  return h.div(
    {
      class: "demo-box",
      style: {
        backgroundColor: backgroundStream,
        transition: "background-color 0.05s",
      },
    },
    "Hue",
  );
};

// ============================================================================
// Example 2: Object Form Styles (Static)
// ============================================================================

const ObjectStyleBox = () =>
  h.div(
    {
      class: "demo-box",
      style: {
        backgroundColor: "#667eea",
        boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4)",
      },
    },
    "Object",
  );

// ============================================================================
// Example 3: Entire Style Object as Stream
// ============================================================================

const StyleSwitcher = () => {
  const styleStream = Stream.make(
    {
      backgroundColor: "#667eea",
      transform: "scale(1)",
    },
    {
      backgroundColor: "#764ba2",
      transform: "scale(1.1)",
    },
    {
      backgroundColor: "#4CAF50",
      transform: "scale(0.9)",
    },
  ).pipe(Stream.schedule(Schedule.spaced("1 second")), Stream.forever);

  return h.div(
    {
      class: "demo-box",
      style: {
        ...styleStream,
        transition: "all 0.3s ease",
      },
    },
    "Switch",
  );
};

// ============================================================================
// Example 4: Pulsing Animation
// ============================================================================

const PulsingBox = () => {
  const opacityStream = Stream.make(1, 0.5).pipe(
    Stream.schedule(Schedule.spaced("800 millis")),
    Stream.forever,
  );

  return h.div(
    {
      class: "demo-box",
      style: {
        backgroundColor: "#764ba2",
        opacity: opacityStream,
        transition: "opacity 0.4s ease-in-out",
      },
    },
    "Pulse",
  );
};

// ============================================================================
// Example 5: Size Animation
// ============================================================================

const GrowingBox = () => {
  const sizeStream = Stream.iterate(100, (s) => (s >= 150 ? 100 : s + 10)).pipe(
    Stream.schedule(Schedule.spaced("200 millis")),
  );

  return h.div(
    {
      class: "demo-box",
      style: {
        backgroundColor: "#4CAF50",
        width: Stream.map(sizeStream, (s) => `${s}px`),
        height: Stream.map(sizeStream, (s) => `${s}px`),
        transition: "width 0.2s, height 0.2s",
      },
    },
    "Grow",
  );
};

// ============================================================================
// App
// ============================================================================

const App = () =>
  h.div({}, [
    h.h1({}, "Reactive Styles"),

    h.section({}, [
      h.h2({}, "1. Animated Hue (Individual Property Stream)"),
      h.p({}, "Background color cycles through the color wheel."),
      AnimatedHue(),
    ]),

    h.section({}, [
      h.h2({}, "2. Object Form Styles (Static)"),
      h.p({}, "Standard object syntax for style properties."),
      ObjectStyleBox(),
    ]),

    h.section({}, [
      h.h2({}, "3. Style Object Stream"),
      h.p({}, "Entire style object changes over time."),
      StyleSwitcher(),
    ]),

    h.section({}, [
      h.h2({}, "4. Pulsing Opacity"),
      h.p({}, "Opacity alternates between values."),
      PulsingBox(),
    ]),

    h.section({}, [
      h.h2({}, "5. Growing Size"),
      h.p({}, "Width and height animate via streams."),
      GrowingBox(),
    ]),
  ]);

void Effect.runPromise(mount(App(), document.getElementById("root")!));
