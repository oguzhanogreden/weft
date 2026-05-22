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
        return escapeHtml(String(node));
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
        const attrs = yield* serializeProps(props);
        const openTag = `<${type}${attrs}>`;

        // Void elements have no closing tag and ignore children
        if (VOID_ELEMENTS.has(type)) {
          return openTag;
        }

        const children = yield* fragmentToString(props);
        return `${openTag}${children}</${type}>`;
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

/**
 * HTML void elements: rendered without a closing tag, children are ignored.
 */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ESCAPE_MAP: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#x27;",
  "<": "&lt;",
  ">": "&gt;",
};

/**
 * Escapes the five HTML-significant characters in text content and attribute
 * values. Fork of the `escape-html` package with `'` mapped to `&#x27;`
 * (matching React's Fizz renderer). Coerces input to string first.
 */
function escapeHtml(value: string): string {
  return value.replace(/["'&<>]/g, (char) => ESCAPE_MAP[char] ?? char);
}

/**
 * Converts camelCase to kebab-case for CSS properties.
 */
function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Serializes an element's props into an attribute string (including the leading
 * space for each emitted attribute). Mirrors the special-case ordering of the
 * client renderer's `setElementProps`: children, ref, and event handlers are
 * skipped; `style` is serialized as a declaration list; everything else becomes
 * a plain attribute. Prop names are emitted as-is (no renaming/normalization).
 */
function serializeProps(props: Record<string, unknown>): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    let result = "";

    for (const [name, value] of Object.entries(props)) {
      if (name === "children" || name === "ref" || isEventHandler(name)) {
        continue;
      }

      if (name === "style") {
        result += yield* serializeStyle(value);
        continue;
      }

      result += yield* serializeAttribute(name, value);
    }

    return result;
  });
}

/**
 * Resolves a possibly Stream/Effect value to its final value, taking the last
 * emission (mirroring how children are rendered). Static values pass through.
 */
function resolveValue(value: unknown): Effect.Effect<unknown, Error> {
  if (isStream(value) || Effect.isEffect(value)) {
    return normalizeToStream(value).pipe(
      Stream.runLast,
      Effect.map(Option.getOrElse(() => undefined)),
    );
  }
  return Effect.succeed(value);
}

/**
 * Serializes a single attribute into ` name="value"` (with leading space), or
 * an empty string if it should be omitted. Mirrors the client's attribute
 * semantics: null/undefined omitted, booleans render as `name=""`/omitted,
 * everything else is coerced to a string and escaped.
 */
function serializeAttribute(name: string, value: unknown): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const resolved = yield* resolveValue(value);

    if (resolved === null || resolved === undefined) {
      return "";
    }

    if (typeof resolved === "boolean") {
      return resolved ? ` ${name}=""` : "";
    }

    // oxlint-disable-next-line typescript/no-base-to-string
    return ` ${name}="${escapeHtml(String(resolved))}"`;
  });
}

/**
 * Serializes the `style` prop into ` style="..."` (with leading space), or an
 * empty string if it produces no declarations. Accepts a string, an object of
 * (possibly Stream/Effect) declarations, or a Stream/Effect resolving to either.
 */
function serializeStyle(value: unknown): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const resolved = yield* resolveValue(value);

    if (resolved === null || resolved === undefined) {
      return "";
    }

    if (typeof resolved === "string") {
      return resolved === "" ? "" : ` style="${escapeHtml(resolved)}"`;
    }

    if (typeof resolved === "object") {
      const declarations: string[] = [];

      for (const [key, raw] of Object.entries(resolved as Record<string, unknown>)) {
        const propValue = yield* resolveValue(raw);
        if (propValue === null || propValue === undefined) {
          continue;
        }
        // oxlint-disable-next-line typescript/no-base-to-string
        declarations.push(`${camelToKebab(key)}: ${String(propValue)}`);
      }

      if (declarations.length === 0) {
        return "";
      }

      return ` style="${escapeHtml(declarations.join("; "))}"`;
    }

    return "";
  });
}
