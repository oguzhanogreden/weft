/**
 * Comment-marker vocabulary shared between the client renderer (which creates
 * markers around reactive children) and the hydratable server renderer (which
 * emits the same markers into HTML so the hydrator can locate reactive regions).
 *
 * A reactive (`Stream`/`Effect`) region collapses to 0, 1, or many DOM nodes, so
 * its boundaries cannot be found by a structural walk alone. These markers
 * delimit each region: `<!-- stream-start-N -->` … `<!-- stream-end-N -->`.
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
