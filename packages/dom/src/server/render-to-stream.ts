import { FRAGMENT } from "@effect-ui/core/jsx-runtime";
import type { JSXNode } from "@effect-ui/core/types";
import { Effect, Option, Stream } from "effect";
import {
  escapeHtml,
  isStream,
  normalizeToStream,
  serializeProps,
  VOID_ELEMENTS,
} from "./serialize";

/**
 * Progressively serializes an Effect-infused JSX tree (`JSXNode`) into a stream
 * of HTML string chunks, in render-tree order. Chunks emitted before a slow
 * `Stream`/`Effect` node flush to the consumer while that node is still
 * resolving (mirroring React Fizz's interleaved work/flush), and Effect's
 * pull-based streams provide backpressure.
 *
 * Shell-only: reactive (`Stream`/`Effect`) values are collapsed to their last
 * emission before that chunk is emitted. There is no Suspense/late-reveal.
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
  // Collapse to the last emission, then render that recursively.
  if (isStream(node) || Effect.isEffect(node)) {
    return Stream.unwrap(
      normalizeToStream(node).pipe(
        Stream.runLast,
        Effect.map(Option.match({ onNone: () => Stream.empty, onSome: renderToStream })),
      ),
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
  }

  return Stream.fail(new Error(`Unsupported node type: ${typeof node}`));
};

function fragmentToStream(props: Record<string, unknown>): Stream.Stream<string, Error> {
  const children = "children" in props ? props.children : undefined;

  if (children == null) {
    return Stream.empty;
  }

  const childArray = Array.isArray(children) ? children : [children];
  return Stream.flatMap(Stream.fromIterable(childArray), renderToStream);
}
