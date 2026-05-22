import { FRAGMENT } from "@effect-ui/core/jsx-runtime";
import type { JSXNode } from "@effect-ui/core/types";
import { Effect, Option, Stream } from "effect";

export const renderToString = (node: JSXNode): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    // stfu
    yield* Effect.void;

    // Handle primitives
    {
      // null/undefined/void render nothing
      if (node == null) {
        return "";
      }

      // booleans render nothing
      if (typeof node === "boolean") {
        return "";
      }

      if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
        return String(node);
      }
    }

    // Check for Stream/Effect first (before iterables, since Stream might be iterable)
    if (isStream(node) || Effect.isEffect(node)) {
      return yield* normalizeToStream(node).pipe(
        Stream.mapEffect((node) => renderToString(node)),
        Stream.runLast,
        Effect.map(Option.getOrElse(() => "")),
      );
    }

    // Handle iterables
    if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
      return yield* Effect.all(Iterator.from(node).map(renderToString)).pipe(
        Effect.map((item) => item.join("")),
      );
    }

    // Handle JSX elements: { type, props }
    if (typeof node === "object" && "type" in node && !(Symbol.iterator in node)) {
      const { type, props } = node;

      if (type === FRAGMENT) {
        return yield* fragmentToString(props);
      }

      // AC4: Element (string type)
      if (typeof type === "string") {
        const separator = " ";
        const assign = '="';
        const end = '"';
        const emptyString = '=""';
        const openTag = `<${type}>`;
        const closeTag = `</${type}>`;
        return yield* Effect.fail(new Error("not implemented"));
      }
    }

    return yield* Effect.fail(new Error(`Unsupported node type: ${typeof node}`));
  });

function isStream(value: unknown): value is Stream.Stream<unknown, any, any> {
  return typeof value === "object" && value != null && Stream.StreamTypeId in value;
}

function normalizeToStream<A>(value: A | Effect.Effect<A> | Stream.Stream<A>): Stream.Stream<A> {
  if (isStream(value)) {
    return value;
  }
  if (Effect.isEffect(value)) {
    return Stream.fromEffect(value);
  }
  return Stream.make(value);
}

function fragmentToString(props: Record<string, unknown>) {
  return Effect.gen(function* () {
    const children = "children" in props ? props.children : undefined;

    if (children == null) {
      return "";
    }

    const childArray = Array.isArray(children) ? children : [children];
    return yield* Effect.all(childArray.map(renderToString)).pipe(
      Effect.map((item) => item.join("")),
    );
  });
}

function isEventHandler(name: string): boolean {
  if (name.length <= 2 || !name.startsWith("on")) {
    return false;
  }
  const thirdChar = name[2];
  // Must be a lowercase letter (a-z), not a number or uppercase
  return thirdChar !== undefined && thirdChar >= "a" && thirdChar <= "z";
}
