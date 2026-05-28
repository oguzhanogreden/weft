import { isStream, toStream } from "@effect-ui/core";
import { Effect, Option, Stream } from "effect";

/**
 * Determines whether a prop name is an event handler (`on` + lowercase letter),
 * which is skipped during attribute serialization.
 */
export function isEventHandler(name: string): boolean {
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
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
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
export function escapeHtml(value: string): string {
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
export function serializeProps(props: Record<string, unknown>): Effect.Effect<string, Error> {
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
 * Resolves a possibly Stream/Effect value to its first/current emission
 * (mirroring how children are rendered, and matching the client's initial
 * paint). Using the first emission also lets non-terminating streams (e.g.
 * `SubscriptionRef.changes`) resolve immediately instead of hanging. Static
 * values pass through.
 */
function resolveValue(value: unknown): Effect.Effect<unknown, Error> {
  if (isStream(value) || Effect.isEffect(value)) {
    return toStream(value).pipe(Stream.runHead, Effect.map(Option.getOrElse(() => undefined)));
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
