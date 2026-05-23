import { FRAGMENT } from "@effect-ui/core/jsx-runtime";
import type { JSXNode } from "@effect-ui/core/types";
import { Effect, Option, Stream } from "effect";
import { streamEndText, streamStartText } from "../client/markers";
import {
  escapeHtml,
  isStream,
  normalizeToStream,
  serializeProps,
  VOID_ELEMENTS,
} from "./serialize";
import { UnsupportedNodeTypeError } from "../data";

/**
 * Progressively serializes an Effect-infused JSX tree (`JSXNode`) into a stream
 * of HTML string chunks, in render-tree order. Chunks emitted before a slow
 * `Stream`/`Effect` node flush to the consumer while that node is still
 * resolving (mirroring React Fizz's interleaved work/flush), and Effect's
 * pull-based streams provide backpressure.
 *
 * Shell-only: reactive (`Stream`/`Effect`) values are collapsed to their
 * first/current emission before that chunk is emitted. There is no
 * Suspense/late-reveal.
 */
export const renderToStream = (node: JSXNode): Stream.Stream<string, Error> => {
  // Handle primitives
  {
    // null/undefined/void and booleans render nothing
    if (node == null || typeof node === "boolean") {
      return Stream.empty;
    }

    if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
      return Stream.make(escapeHtml(String(node)));
    }
  }

  // Check for Stream/Effect first (before iterables, since Stream might be iterable).
  // Collapse to the first/current emission, then render that recursively.
  if (isStream(node) || Effect.isEffect(node)) {
    return normalizeToStream(node).pipe(
      Stream.runHead,
      Effect.map(Option.match({ onNone: () => Stream.empty, onSome: renderToStream })),
      Stream.unwrap,
    );
  }

  // Handle iterables: render children in order.
  if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
    return Stream.flatMap(Stream.fromIterable(node), renderToStream);
  }

  // Handle JSX elements: { type, props }
  if (typeof node === "object" && "type" in node && !(Symbol.iterator in node)) {
    const { type, props } = node;

    if (type === FRAGMENT) {
      return fragmentToStream(props);
    }

    if (typeof type === "string") {
      const openTag = Stream.fromEffect(
        serializeProps(props).pipe(Effect.map((attrs) => `<${type}${attrs}>`)),
      );

      // Void elements have no closing tag and ignore children
      if (VOID_ELEMENTS.has(type)) {
        return openTag;
      }

      return openTag.pipe(
        Stream.concat(fragmentToStream(props)),
        Stream.concat(Stream.make(`</${type}>`)),
      );
    }

    // Function component: invoke once with props, render its result recursively.
    if (typeof type === "function") {
      return renderToStream((type as (p: Record<string, unknown>) => JSXNode)(props));
    }
  }

  return Stream.fail(
    new UnsupportedNodeTypeError({
      type: node.type,
      message: `Invalid JSXNode type: expected string, FRAGMENT, or function, got ${typeof node.type}`,
    }),
  );
};

function fragmentToStream(props: Record<string, unknown>): Stream.Stream<string, Error> {
  const children = "children" in props ? props.children : undefined;

  if (children == null) {
    return Stream.empty;
  }

  const childArray = Array.isArray(children) ? children : [children];
  return Stream.flatMap(Stream.fromIterable(childArray), renderToStream);
}

// ============================================================================
// Hydratable variant
// ============================================================================

/**
 * Mutable counter threaded through a single hydratable render pass, assigning a
 * monotonic id to each reactive region in document order. Ids are primarily for
 * debugging/validation — the hydrator pairs markers positionally, so exact
 * alignment with the client renderer's counter is not required.
 */
interface RegionCounter {
  current: number;
}

/**
 * Like {@link renderToStream}, but wraps each reactive (`Stream`/`Effect`)
 * region in `<!-- stream-start-N -->` … `<!-- stream-end-N -->` comment markers
 * so the client `hydrate` can locate the region's boundaries (a reactive region
 * may collapse to 0, 1, or many nodes). Static structure is emitted identically
 * to {@link renderToStream}; the markers are the only difference from plain SSR.
 */
export const renderToStreamHydratable = (node: JSXNode): Stream.Stream<string, Error> =>
  renderHydratable(node, { current: 0 });

function renderHydratable(node: JSXNode, counter: RegionCounter): Stream.Stream<string, Error> {
  // Primitives
  if (node == null || typeof node === "boolean") {
    return Stream.empty;
  }

  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return Stream.make(escapeHtml(String(node)));
  }

  // Reactive region: collapse to first/current emission, wrapped in boundary markers.
  if (isStream(node) || Effect.isEffect(node)) {
    return normalizeToStream(node).pipe(
      Stream.runHead,
      Effect.map((first) => {
        const id = ++counter.current;
        const inner = Option.match(first, {
          onNone: () => Stream.empty,
          onSome: (value: JSXNode) => renderHydratable(value, counter),
        });
        return Stream.make(`<!--${streamStartText(id)}-->`).pipe(
          Stream.concat(inner),
          Stream.concat(Stream.make(`<!--${streamEndText(id)}-->`)),
        );
      }),
      Stream.unwrap,
    );
  }

  // Iterables
  if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
    return Stream.flatMap(Stream.fromIterable(node), (child) => renderHydratable(child, counter));
  }

  // JSX elements
  if (typeof node === "object" && "type" in node && !(Symbol.iterator in node)) {
    const { type, props } = node;

    if (type === FRAGMENT) {
      return fragmentToStreamHydratable(props, counter);
    }

    if (typeof type === "string") {
      const openTag = Stream.fromEffect(
        serializeProps(props).pipe(Effect.map((attrs) => `<${type}${attrs}>`)),
      );

      if (VOID_ELEMENTS.has(type)) {
        return openTag;
      }

      return openTag.pipe(
        Stream.concat(fragmentToStreamHydratable(props, counter)),
        Stream.concat(Stream.make(`</${type}>`)),
      );
    }

    // Function component: invoke once with props, render its result recursively.
    if (typeof type === "function") {
      return renderHydratable((type as (p: Record<string, unknown>) => JSXNode)(props), counter);
    }
  }

  return Stream.fail(
    new UnsupportedNodeTypeError({
      type: node.type,
      message: `Invalid JSXNode type: expected string, FRAGMENT, or function, got ${typeof node.type}`,
    }),
  );
}

function fragmentToStreamHydratable(
  props: Record<string, unknown>,
  counter: RegionCounter,
): Stream.Stream<string, Error> {
  const children = "children" in props ? props.children : undefined;

  if (children == null) {
    return Stream.empty;
  }

  const childArray = Array.isArray(children) ? children : [children];
  return Stream.flatMap(Stream.fromIterable(childArray), (child) =>
    renderHydratable(child, counter),
  );
}
