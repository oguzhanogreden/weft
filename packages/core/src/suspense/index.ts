import type { JSXNode } from "~/types";

/**
 * Props for the {@link Suspense} boundary component.
 */
export interface SuspenseProps {
  /**
   * Shown in the DOM while async children are pending. Pass `null` or omit to
   * render nothing (only the comment markers) while pending.
   */
  readonly fallback?: JSXNode;
  /** The children to render inside the boundary. */
  readonly children?: JSXNode | readonly JSXNode[];
}

/**
 * Suspense boundary. Shows `fallback` while async function-component children
 * are pending (have not yet emitted their first value), then atomically swaps
 * to the resolved children once **all** pending children have settled.
 *
 * Rendering behaviour is implemented by the active renderer (`@effect-ui/dom`).
 * This export is a **sentinel/marker** function recognised by the renderer via
 * reference equality (`type === Suspense`). It must never be called directly.
 *
 * @example
 * ```tsx
 * import { Suspense } from "@effect-ui/core";
 *
 * <Suspense fallback={<Spinner />}>
 *   <AsyncCard />
 *   <AsyncSidebar />
 * </Suspense>
 * ```
 */
export function Suspense(_props: SuspenseProps): JSXNode {
  throw new Error(
    "[effect-ui] Suspense must be rendered inside a mount() or hydrate() call. " +
      "Make sure @effect-ui/dom is configured as your renderer.",
  );
}
