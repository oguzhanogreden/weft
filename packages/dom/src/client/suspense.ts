import { Deferred, Effect, Option, Ref, pipe } from "effect";
import type { JSXNode } from "@effect-ui/core/types";
import type { SuspenseProps } from "@effect-ui/core/suspense";
import {
  type RenderError,
  type StreamSubscriptionError,
  type UnsupportedNodeTypeError,
  RenderContext,
  SuspenseContext,
} from "../data";
import { suspenseEndText, suspenseStartText } from "./markers";
import { nextSuspenseId } from "../utilities";
// NOTE: circular import — render-core also imports from this module.
// All values are used inside function bodies only (never at module-init time),
// so live bindings resolve correctly before any function is called.
import { removeNodesBetweenMarkers, renderNode } from "./render-core";

/**
 * Implements the `<Suspense>` boundary for the DOM renderer.
 *
 * Shows `props.fallback` (bracketed by comment markers) while any async child
 * component is pending, then atomically swaps to the resolved children once
 * every registered child has emitted its first value.
 *
 * A sentinel of `1` is added to `pendingRef` at the start so that a
 * very-fast child cannot complete `allSettled` before all siblings have had a
 * chance to register. The sentinel is released after `renderChildren` returns.
 */
export function renderSuspenseBoundary(
  props: SuspenseProps,
): Effect.Effect<
  readonly Node[],
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;

    // ── 1. Sentinel: start at 1 so a fast child can't settle early ──────────
    const pendingRef = yield* Ref.make(1);

    // ── 2. Fires when all children (+ sentinel) have settled ─────────────────
    const allSettled = yield* Deferred.make<void>();

    // ── 3. Service exposed to child components in this boundary ──────────────
    const settle: Effect.Effect<void> = pipe(
      Ref.updateAndGet(pendingRef, (n) => n - 1),
      Effect.flatMap((n) =>
        n <= 0
          ? Effect.asVoid(Deferred.succeed(allSettled, undefined as unknown as void))
          : Effect.void,
      ),
    );

    const suspenseService = {
      register: Ref.update(pendingRef, (n) => n + 1),
      settle,
    };

    // ── 4. Render children with SuspenseContext in scope ─────────────────────
    const rawChildren = props.children;
    const childArray: readonly JSXNode[] =
      rawChildren === undefined
        ? []
        : Array.isArray(rawChildren)
          ? (rawChildren as readonly JSXNode[])
          : [rawChildren as JSXNode];

    // renderNode handles arrays via its iterable branch → returns readonly Node[]
    const childResult = yield* (
      renderNode(childArray as JSXNode) as ReturnType<typeof renderNode>
    ).pipe(Effect.provideService(SuspenseContext, suspenseService));

    const childNodes: readonly Node[] = (() => {
      if (childResult === null) return [];
      if (Array.isArray(childResult)) return childResult as Node[];
      return [childResult as Node];
    })();

    // ── 5. Release sentinel ──────────────────────────────────────────────────
    yield* settle;

    // ── 6. Fast path: all children were synchronous — no boundary needed ─────
    const polled = yield* Deferred.poll(allSettled);
    if (Option.isSome(polled)) {
      return childNodes;
    }

    // ── 7. Async path: show fallback while children settle ───────────────────
    const boundaryId = yield* nextSuspenseId();
    const startMarker = document.createComment(suspenseStartText(boundaryId));
    const endMarker = document.createComment(suspenseEndText(boundaryId));

    // ── 8. Render fallback (null/undefined → empty, only markers shown) ──────
    const fallbackResult = yield* renderNode((props.fallback ?? null) as JSXNode);
    const fallbackNodes: Node[] = [];
    if (fallbackResult !== null) {
      if (Array.isArray(fallbackResult)) {
        fallbackNodes.push(...(fallbackResult as Node[]));
      } else {
        fallbackNodes.push(fallbackResult as Node);
      }
    }

    // Put child nodes into a DocumentFragment so that nested Suspense swaps
    // can find their parent (innerStart.parentNode = childFragment) even while
    // the outer boundary is still pending and its nodes are detached.
    const childFragment = document.createDocumentFragment();
    for (const node of childNodes) {
      childFragment.appendChild(node);
    }

    // ── 9. Fork swap fiber in the render scope ───────────────────────────────
    const swapEffect = Effect.gen(function* () {
      yield* Deferred.await(allSettled);

      // Remove fallback content between markers.
      removeNodesBetweenMarkers(startMarker, endMarker);

      // Insert resolved children (from fragment) before the end marker.
      // insertBefore with a DocumentFragment moves all its children at once.
      const parent = endMarker.parentNode;
      if (parent !== null) {
        parent.insertBefore(childFragment, endMarker);
        startMarker.remove();
        endMarker.remove();
      }
    });

    yield* Effect.forkIn(swapEffect, context.scope);

    // ── 10. Return boundary: [startMarker, ...fallbackNodes, endMarker] ──────
    return [startMarker, ...fallbackNodes, endMarker];
  });
}
