import { Either, Schema } from "effect";
import type { Compiled, CompiledLeaf } from "./compile";

/** The resolved match for a URL: a leaf with decoded params/query, or not-found. */
export type RouteMatch =
  | {
      readonly _tag: "Matched";
      readonly leaf: CompiledLeaf;
      readonly path: Record<string, unknown>;
      readonly query: Record<string, unknown>;
      /** Normalized request URL (path + search), used by the outlet as a dedupe key. */
      readonly url: string;
    }
  | {
      readonly _tag: "NotFound";
      readonly url: string;
    };

/** A precompiled regex + param-name list for one leaf. */
interface MatcherEntry {
  readonly leaf: CompiledLeaf;
  readonly regex: RegExp;
  readonly paramNames: readonly string[];
}

/** Escapes a literal path segment for inclusion in a `RegExp`. */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Number of `:param` segments in a pattern; fewer params = more specific (M6). */
function paramCount(pattern: string): number {
  return pattern.split("/").filter((s) => s.startsWith(":")).length;
}

/** Builds a regex matching a full pattern, tolerating an optional trailing slash (M3). */
function patternToRegex(pattern: string): RegExp {
  const parts = pattern.split("/").filter((s) => s.length > 0);
  const body = parts
    .map((part) => (part.startsWith(":") ? "([^/]+)" : escapeRegex(part)))
    .join("/");
  return new RegExp(body.length === 0 ? "^/?$" : `^/${body}/?$`);
}

/**
 * Memoizes the compiled matcher entries per {@link Compiled} so the regexes are
 * built and sorted once, not on every `match()` call (which is on the hot path:
 * every navigation, every link-interceptor click, and once per server request).
 */
const matchersCache: WeakMap<Compiled, readonly MatcherEntry[]> = new WeakMap();

/**
 * Precompiles the leaves of a {@link Compiled} tree into ordered matcher entries
 * (memoized per `Compiled`). Entries are sorted most-specific first (fewer
 * params, then longer pattern) so a static segment wins over a param segment at
 * the same position (M6).
 *
 * Note: the specificity order is a global heuristic (param count, then length).
 * It resolves the common "static beats param at the same position" case, but two
 * patterns with the same param count and length (e.g. `/a/:b/c` vs `/a/x/:d`)
 * fall back to document order.
 */
export function compileMatchers(compiled: Compiled): readonly MatcherEntry[] {
  const cached = matchersCache.get(compiled);
  if (cached !== undefined) return cached;
  const entries = compiled.leaves
    .map(
      (leaf): MatcherEntry => ({
        leaf,
        regex: patternToRegex(leaf.fullPathPattern),
        paramNames: leaf.paramNames,
      }),
    )
    .slice()
    .sort((a, b) => {
      const pc = paramCount(a.leaf.fullPathPattern) - paramCount(b.leaf.fullPathPattern);
      if (pc !== 0) return pc;
      return b.leaf.fullPathPattern.length - a.leaf.fullPathPattern.length;
    });
  matchersCache.set(compiled, entries);
  return entries;
}

/** Splits a request URL into its normalized path and raw query string. */
function splitUrl(url: string): { readonly path: string; readonly search: string } {
  const hashIndex = url.indexOf("#");
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const qIndex = withoutHash.indexOf("?");
  const rawPath = qIndex === -1 ? withoutHash : withoutHash.slice(0, qIndex);
  const search = qIndex === -1 ? "" : withoutHash.slice(qIndex + 1);
  // Normalize: ensure a single leading slash, strip a trailing slash (except root).
  let path = rawPath.length === 0 ? "/" : rawPath;
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { path, search };
}

/** Parses a raw query string into a flat record (last value wins on repeat). */
function parseQuery(search: string): Record<string, string> {
  const record: Record<string, string> = {};
  if (search.length === 0) return record;
  for (const [key, value] of new URLSearchParams(search)) {
    record[key] = value;
  }
  return record;
}

/**
 * Matches a request URL against a compiled tree (M1–M7). Returns the decoded
 * `Matched` leaf, or `NotFound` when nothing matches or a path/query decode fails
 * (decode failure is treated as no-match, not an error).
 */
export function match(compiled: Compiled, url: string): RouteMatch {
  const entries = compileMatchers(compiled);
  const { path, search } = splitUrl(url);
  const normalizedUrl = search.length === 0 ? path : `${path}?${search}`;

  for (const entry of entries) {
    const m = entry.regex.exec(path);
    if (m === null) continue;

    const rawParams: Record<string, string> = {};
    entry.paramNames.forEach((name, i) => {
      const raw = m[i + 1];
      if (raw !== undefined) rawParams[name] = decodeURIComponent(raw);
    });

    const decodedPath = Schema.decodeUnknownEither(entry.leaf.pathSchema)(rawParams);
    if (Either.isLeft(decodedPath)) continue;

    // M8: a query decode failure (a declared query field whose value violates its
    // schema, e.g. `?page=abc` for `NumberFromString`) is a no-match, like a path
    // decode failure — not a thrown error. Excess/undeclared query keys are
    // ignored by `Schema.Struct`, so only declared-but-invalid values 404.
    const decodedQuery = Schema.decodeUnknownEither(entry.leaf.querySchema)(parseQuery(search));
    if (Either.isLeft(decodedQuery)) continue;

    return {
      _tag: "Matched",
      leaf: entry.leaf,
      path: decodedPath.right,
      query: decodedQuery.right,
      url: normalizedUrl,
    };
  }

  return { _tag: "NotFound", url: normalizedUrl };
}
