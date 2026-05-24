/**
 * Comment-marker vocabulary shared between the client renderer, the hydratable
 * server renderer, and the Suspense boundary implementation.
 *
 * **Reactive regions** (`stream-start-N` / `stream-end-N`): bracket the DOM
 * nodes produced by a `Stream`/`Effect` child. Used by the client renderer to
 * locate the region on each emission, and by the server hydratable renderer so
 * the hydrator can find reactive regions in server-rendered HTML.
 *
 * **Suspense boundaries** (`suspense-start-N` / `suspense-end-N`): bracket the
 * fallback DOM nodes while async children are pending. Removed from the DOM
 * after the client-side swap (or replaced by the SSR patch script on the
 * server). IDs for both marker kinds are drawn from the same monotonic counter
 * (`RenderContext.streamIdCounter`) and are therefore unique within a single
 * render tree.
 */

/**
 * Text content (without the `<!--`/`-->` delimiters) of a reactive region's
 * opening comment marker, e.g. `" stream-start-3 "`.
 */
export function streamStartText(id: number): string {
  return ` stream-start-${id} `;
}

/**
 * Text content of a reactive region's closing comment marker, e.g.
 * `" stream-end-3 "`.
 */
export function streamEndText(id: number): string {
  return ` stream-end-${id} `;
}

/**
 * The kind and id parsed from a stream marker comment.
 */
export interface StreamMarker {
  readonly kind: "start" | "end";
  readonly id: number;
}

// ============================================================================
// Suspense boundary markers
// ============================================================================

/**
 * Text content (without the `<!--`/`-->` delimiters) of a Suspense boundary's
 * opening comment marker, e.g. `" suspense-start-3 "`.
 *
 * On the client, this marker is inserted before the fallback content while async
 * children are pending and removed after the DOM swap completes.
 * On the server, it is emitted inline so the SSR patch script can locate the
 * boundary via `TreeWalker`.
 */
export function suspenseStartText(id: number): string {
  return ` suspense-start-${id} `;
}

/**
 * Text content of a Suspense boundary's closing comment marker, e.g.
 * `" suspense-end-3 "`.
 */
export function suspenseEndText(id: number): string {
  return ` suspense-end-${id} `;
}

/**
 * The kind and id parsed from a suspense boundary marker comment.
 */
export interface SuspenseMarker {
  readonly kind: "start" | "end";
  readonly id: number;
}

const SUSPENSE_MARKER_PATTERN = /^ suspense-(start|end)-(\d+) $/;

/**
 * Recognises a comment node as a Suspense boundary start/end marker, returning
 * its kind and id, or `null` if the comment is not a suspense marker.
 */
export function parseSuspenseMarker(comment: Comment): SuspenseMarker | null {
  const match = SUSPENSE_MARKER_PATTERN.exec(comment.data);
  if (match === null) {
    return null;
  }
  const kind = match[1] as "start" | "end";
  // biome-ignore lint/style/noNonNullAssertion: regex guarantees group 2 on match
  const id = Number.parseInt(match[2]!, 10);
  return { kind, id };
}

// ============================================================================
// Stream region markers
// ============================================================================

const MARKER_PATTERN = /^ stream-(start|end)-(\d+) $/;

/**
 * Recognises a comment node as a reactive-region start/end marker, returning its
 * kind and id, or `null` if the comment is not a stream marker.
 */
export function parseStreamMarker(comment: Comment): StreamMarker | null {
  const match = MARKER_PATTERN.exec(comment.data);
  if (match === null) {
    return null;
  }
  const kind = match[1] as "start" | "end";
  // biome-ignore lint/style/noNonNullAssertion: regex guarantees group 2 on match
  const id = Number.parseInt(match[2]!, 10);
  return { kind, id };
}
