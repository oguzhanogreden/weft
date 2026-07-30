/**
 * Emitting and reading the `noai` opt-out signal.
 *
 * The signal has two halves that live in different places. The header half is an
 * `X-Robots-Tag` response header, invisible in the DOM. The document half is a
 * `robots` meta tag. Both are produced here, and both are asserted by the node
 * test rather than the browser test: a browser-mode mount has no `<head>` from
 * `index.html` (see `src/specs.md`, AC-SIGNAL-HEADER / AC-SIGNAL-META).
 *
 * `noai` and `noimageai` are a convention that originated outside the standards
 * process. This module emits and parses them. It makes no claim about who honors
 * them (see the Documentation Constraint in `src/specs.md`).
 */

import { Data, Effect, Option, pipe } from "effect";
import type { SignalSnapshot } from "../src/transport";

/** The directive value emitted in both halves of the signal. */
export const NOAI_DIRECTIVE: string = "noai, noimageai";

/** Response header name carrying the directive. */
export const X_ROBOTS_TAG: string = "X-Robots-Tag";

/** The meta tag injected into `<head>`, as a complete tag string. */
export const ROBOTS_META_TAG: string = `<meta name="robots" content="${NOAI_DIRECTIVE}">`;

/**
 * A `robots` meta tag in any attribute order. Non-global on purpose: a global
 * regex carries `lastIndex` between calls, so a shared one would match every
 * other time.
 */
const ROBOTS_META = /<meta[^>]*\bname=["']robots["'][^>]*>/i;

const CONTENT_ATTRIBUTE = /\bcontent=["']([^"']*)["']/i;

/** An opening `<head>` with or without attributes, so `<head lang="en">` matches. */
const HEAD_OPEN = /<head\b[^>]*>/i;

/**
 * Insert a tag at the top of `<head>`, or at the top of the document when there
 * is no head.
 *
 * Shared rather than inlined per call site. A literal `replace("<head>", …)`
 * silently no-ops on `<head lang="en">`, and the two callers here fail
 * differently when that happens: the signal loses half itself, and the transport
 * meta tag goes missing, which the client reads as a live run. Both call sites
 * now go through one implementation that matches `<head>` as a tag.
 */
export const injectIntoHead = (html: string, tag: string): string => {
  const head = HEAD_OPEN.exec(html);
  return head === null ? `${tag}${html}` : html.replace(head[0], `${head[0]}${tag}`);
};

/** Apply the `X-Robots-Tag` header to an outgoing response (AC-SIGNAL-HEADER). */
export const withNoaiHeader = (headers: Headers): Headers => {
  // Copied rather than mutated: the caller's headers stay theirs.
  const next = new Headers(headers);
  next.set(X_ROBOTS_TAG, NOAI_DIRECTIVE);
  return next;
};

/**
 * Inject the `robots` meta tag into an HTML document's `<head>`
 * (AC-SIGNAL-META). Idempotent: a document that already carries the tag is
 * returned unchanged, so double-injection cannot produce two tags.
 *
 * Prepends the tag when there is no `<head>` to inject into. Returning the
 * document untouched would drop half the signal and report success, and this
 * function has no error channel to say otherwise.
 */
export const injectRobotsMeta = (html: string): string => {
  if (ROBOTS_META.test(html)) {
    return html;
  }
  return injectIntoHead(html, ROBOTS_META_TAG);
};

/** Malformed or unreachable target while reading the signal. */
export class SignalFetchError extends Data.TaggedError("SignalFetchError")<{
  readonly reason: string;
}> {}

/**
 * Extract the `content` attribute of a `robots` meta tag from an HTML document.
 * Verbatim, no normalization: the panel shows what was received
 * (AC-SIGNAL-PANEL). Pure, and the main thing the node test pins.
 */
export const parseRobotsMeta = (html: string): Effect.Effect<Option.Option<string>> =>
  Effect.sync(() => {
    const tag = ROBOTS_META.exec(html);
    if (tag === null) {
      return Option.none();
    }
    const content = CONTENT_ATTRIBUTE.exec(tag[0]);
    return content === null ? Option.none() : Option.fromUndefinedOr(content[1]);
  });

const readBody = (response: Response): Effect.Effect<string, SignalFetchError> =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new SignalFetchError({ reason: `could not read the response body: ${String(cause)}` }),
  });

/**
 * Build a snapshot from a real HTTP response. Reads status and the header, then
 * parses the body for the meta tag (AC-FETCH).
 */
export const snapshotFromResponse = (
  response: Response,
): Effect.Effect<SignalSnapshot, SignalFetchError> =>
  Effect.gen(function* () {
    // A non-200 is a finding, not a failure: the crawler reports what it got.
    const body = yield* readBody(response);
    return {
      status: response.status,
      // `fromNullOr`, not a truthiness check: an empty header is a different
      // finding from an absent one.
      xRobotsTag: Option.fromNullOr(response.headers.get(X_ROBOTS_TAG)),
      robotsMeta: yield* parseRobotsMeta(body),
    };
  });

/**
 * Fetch the example's own SSR route and snapshot the signal it carries.
 *
 * Deliberately not a general-purpose fetch: it takes no URL from the model and
 * targets the configured route only, so the crawler agent cannot wander
 * (see `src/specs.md`, Self-fetch loop).
 */
export const fetchOwnSignal = (origin: string): Effect.Effect<SignalSnapshot, SignalFetchError> =>
  pipe(
    Effect.tryPromise({
      try: (signal) => fetch(new URL("/", origin), { signal }),
      catch: (cause) =>
        new SignalFetchError({ reason: `could not reach ${origin}: ${String(cause)}` }),
    }),
    Effect.flatMap(snapshotFromResponse),
  );
