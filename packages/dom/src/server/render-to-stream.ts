import { FRAGMENT } from "@effect-ui/core/jsx-runtime";
import { isStream, Suspense, type SuspenseProps, toStream } from "@effect-ui/core";
import type { JSXNode } from "@effect-ui/core/types";
import { Effect, Option, Queue, Ref, Scope, Stream } from "effect";
import { suspenseEndText, suspenseStartText, streamEndText, streamStartText } from "~/shared";
import { UnsupportedNodeTypeError } from "~/data";
import { escapeHtml, serializeProps, VOID_ELEMENTS } from "./serialize";

// ============================================================================
// Internal types
// ============================================================================

/**
 * Mutable counter threaded through a single hydratable render pass, assigning a
 * monotonic id to each reactive region in document order.
 */
interface RegionCounter {
  current: number;
}

/**
 * Patch infrastructure created once per `renderToStream` /
 * `renderToStreamHydratable` call. Threaded through the recursive render
 * functions so every `<Suspense>` boundary in the tree can share it.
 */
interface ServerSuspenseCtx {
  /** Serialised patch strings pushed here as each boundary resolves. */
  readonly patchQueue: Queue.Queue<string>;
  /** Number of boundaries not yet resolved; drives queue shutdown. */
  readonly pendingCount: Ref.Ref<number>;
  /** Monotonic boundary-id counter (shared with region counter). */
  readonly idCounter: { current: number };
  /**
   * The scope that spans the entire combined stream (main + patch).
   * Resolution fibers are forked into this scope so they survive the main
   * stream and are interrupted if the consumer cancels.
   */
  readonly scope: Scope.Scope;
}

// ============================================================================
// Patch builder
// ============================================================================

/**
 * Produces the `<template id="ef-s-N">…</template><script>…</script>` pair
 * that the browser executes to swap the fallback for resolved content.
 */
function buildPatch(id: number, html: string): string {
  const startText = suspenseStartText(id);
  const endText = suspenseEndText(id);
  return (
    `<template id="ef-s-${id}">${html}</template>` +
    `<script>(function(){` +
    `var w=document.createTreeWalker(document,128),s,e;` +
    `while(w.nextNode()){var d=w.currentNode.data;` +
    `if(d==="${startText}")s=w.currentNode;` +
    `if(d==="${endText}"){e=w.currentNode;break;}}` +
    `if(!s||!e)return;` +
    `var p=s.parentNode,c=s.nextSibling,n;` +
    `while(c&&c!==e){n=c.nextSibling;p.removeChild(c);c=n;}` +
    `var t=document.getElementById("ef-s-${id}");` +
    `p.insertBefore(t.content,e);` +
    `p.removeChild(s);p.removeChild(e);` +
    `t.remove();document.currentScript.remove();` +
    `})();</script>`
  );
}

// ============================================================================
// Shared Suspense SSR helper
// ============================================================================

/**
 * Emits the inline portion of a Suspense boundary (start-marker + fallback +
 * end-marker) and forks a resolution fiber that renders the children HTML,
 * builds a patch, offers it to `ctx.patchQueue`, and decrements
 * `ctx.pendingCount` (shutting down the queue when it reaches 0).
 *
 * `renderFn` is the caller-supplied recursive render function, so the helper
 * works for both the plain-SSR and hydratable-SSR variants.
 */
function renderSuspenseSSRInline(
  props: SuspenseProps,
  ctx: ServerSuspenseCtx,
  renderFn: (node: JSXNode) => Stream.Stream<string, Error>,
): Stream.Stream<string, Error> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const id = ++ctx.idCounter.current;

      // Increment before forking so pendingCount is ≥ 1 during setup,
      // preventing a race where the queue might be shut down too early.
      yield* Ref.update(ctx.pendingCount, (n) => n + 1);

      const childrenNode = (
        props.children === undefined
          ? null
          : Array.isArray(props.children)
            ? (props.children as JSXNode[])
            : (props.children as JSXNode)
      ) as JSXNode;

      // Resolution fiber: renders children to HTML, pushes patch, decrements.
      // Effect.ignore ensures a rendering error never fails the outer scope.
      const resolutionEffect = Effect.gen(function* () {
        const childrenHtml = yield* Stream.mkString(renderFn(childrenNode));
        yield* Queue.offer(ctx.patchQueue, buildPatch(id, childrenHtml));
      }).pipe(
        // Always decrement, even on failure/interruption, so the queue is
        // eventually shut down regardless of rendering errors.
        Effect.ensuring(
          Ref.updateAndGet(ctx.pendingCount, (n) => n - 1).pipe(
            Effect.flatMap((remaining) =>
              remaining <= 0 ? Queue.shutdown(ctx.patchQueue) : Effect.void,
            ),
          ),
        ),
        // Swallow errors: a failed boundary never crashes the outer scope.
        Effect.ignore,
      );

      // Fork into the outer scope so the fiber is interrupted if the consumer
      // cancels the stream, and survives until all patches have been emitted.
      yield* Effect.forkIn(resolutionEffect, ctx.scope);

      const start = `<!--${suspenseStartText(id)}-->`;
      const end = `<!--${suspenseEndText(id)}-->`;
      const fallback = (props.fallback ?? null) as JSXNode;

      return Stream.make(start).pipe(
        Stream.concat(renderFn(fallback)),
        Stream.concat(Stream.make(end)),
      );
    }),
  );
}

// ============================================================================
// Plain SSR  (no reactive-region markers)
// ============================================================================

/**
 * Core SSR render — `ctx` controls Suspense behaviour:
 * - `null`     → fallback-only (no markers, no patches) — used by `renderToString`
 * - non-`null` → full streaming-patch model — used by `renderToStream`
 */
function renderSSRNode(node: JSXNode, ctx: ServerSuspenseCtx | null): Stream.Stream<string, Error> {
  if (node == null || typeof node === "boolean") return Stream.empty;

  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return Stream.make(escapeHtml(String(node)));
  }

  if (isStream(node) || Effect.isEffect(node)) {
    return toStream(node).pipe(
      Stream.runHead,
      Effect.map(
        Option.match({
          onNone: () => Stream.empty,
          onSome: (v: JSXNode) => renderSSRNode(v, ctx),
        }),
      ),
      Stream.unwrap,
    );
  }

  if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
    return Stream.flatMap(Stream.fromIterable(node), (child) =>
      renderSSRNode(child as JSXNode, ctx),
    );
  }

  if (typeof node === "object" && "type" in node && !(Symbol.iterator in node)) {
    const { type, props } = node as { type: unknown; props: Record<string, unknown> };

    if (type === FRAGMENT) {
      return fragmentToSSR(props, ctx);
    }

    if (type === Suspense) {
      const sp = props as unknown as SuspenseProps;
      if (ctx === null) {
        // AC-SS1: renderToString — fallback only, no markers, no patches.
        return renderSSRNode((sp.fallback ?? null) as JSXNode, null);
      }
      return renderSuspenseSSRInline(sp, ctx, (n) => renderSSRNode(n, ctx));
    }

    if (typeof type === "string") {
      const openTag = Stream.fromEffect(
        serializeProps(props).pipe(Effect.map((attrs) => `<${type}${attrs}>`)),
      );
      if (VOID_ELEMENTS.has(type)) return openTag;
      return openTag.pipe(
        Stream.concat(fragmentToSSR(props, ctx)),
        Stream.concat(Stream.make(`</${type}>`)),
      );
    }

    if (typeof type === "function") {
      return renderSSRNode((type as (p: Record<string, unknown>) => JSXNode)(props), ctx);
    }
  }

  return Stream.fail(
    new UnsupportedNodeTypeError({
      type: (node as { type?: unknown }).type,
      message: `Invalid JSXNode type: expected string, FRAGMENT, or function, got ${typeof (node as { type?: unknown }).type}`,
    }),
  );
}

function fragmentToSSR(
  props: Record<string, unknown>,
  ctx: ServerSuspenseCtx | null,
): Stream.Stream<string, Error> {
  const children = "children" in props ? props.children : undefined;
  if (children == null) return Stream.empty;
  const arr = Array.isArray(children) ? children : [children];
  return Stream.flatMap(Stream.fromIterable(arr), (child) => renderSSRNode(child as JSXNode, ctx));
}

// ============================================================================
// Hydratable SSR  (adds reactive-region markers)
// ============================================================================

function renderHydratableSSRNode(
  node: JSXNode,
  counter: RegionCounter,
  ctx: ServerSuspenseCtx | null,
): Stream.Stream<string, Error> {
  if (node == null || typeof node === "boolean") return Stream.empty;

  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return Stream.make(escapeHtml(String(node)));
  }

  if (isStream(node) || Effect.isEffect(node)) {
    return toStream(node).pipe(
      Stream.runHead,
      Effect.map((first) => {
        const id = ++counter.current;
        const inner = Option.match(first, {
          onNone: () => Stream.empty,
          onSome: (value: JSXNode) => renderHydratableSSRNode(value, counter, ctx),
        });
        return Stream.make(`<!--${streamStartText(id)}-->`).pipe(
          Stream.concat(inner),
          Stream.concat(Stream.make(`<!--${streamEndText(id)}-->`)),
        );
      }),
      Stream.unwrap,
    );
  }

  if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
    return Stream.flatMap(Stream.fromIterable(node), (child) =>
      renderHydratableSSRNode(child as JSXNode, counter, ctx),
    );
  }

  if (typeof node === "object" && "type" in node && !(Symbol.iterator in node)) {
    const { type, props } = node as { type: unknown; props: Record<string, unknown> };

    if (type === FRAGMENT) {
      return fragmentToHydratableSSR(props, counter, ctx);
    }

    if (type === Suspense) {
      const sp = props as unknown as SuspenseProps;
      if (ctx === null) {
        return renderHydratableSSRNode((sp.fallback ?? null) as JSXNode, counter, null);
      }
      return renderSuspenseSSRInline(sp, ctx, (n) => renderHydratableSSRNode(n, counter, ctx));
    }

    if (typeof type === "string") {
      const openTag = Stream.fromEffect(
        serializeProps(props).pipe(Effect.map((attrs) => `<${type}${attrs}>`)),
      );
      if (VOID_ELEMENTS.has(type)) return openTag;
      return openTag.pipe(
        Stream.concat(fragmentToHydratableSSR(props, counter, ctx)),
        Stream.concat(Stream.make(`</${type}>`)),
      );
    }

    if (typeof type === "function") {
      return renderHydratableSSRNode(
        (type as (p: Record<string, unknown>) => JSXNode)(props),
        counter,
        ctx,
      );
    }
  }

  return Stream.fail(
    new UnsupportedNodeTypeError({
      type: (node as { type?: unknown }).type,
      message: `Invalid JSXNode type: expected string, FRAGMENT, or function, got ${typeof (node as { type?: unknown }).type}`,
    }),
  );
}

function fragmentToHydratableSSR(
  props: Record<string, unknown>,
  counter: RegionCounter,
  ctx: ServerSuspenseCtx | null,
): Stream.Stream<string, Error> {
  const children = "children" in props ? props.children : undefined;
  if (children == null) return Stream.empty;
  const arr = Array.isArray(children) ? children : [children];
  return Stream.flatMap(Stream.fromIterable(arr), (child) =>
    renderHydratableSSRNode(child as JSXNode, counter, ctx),
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Plain-SSR stream with fallback-only Suspense handling. Used internally by
 * `renderToString` so that `<Suspense>` boundaries emit the fallback without
 * comment markers or patch scripts.
 *
 * @internal
 */
export const renderToStreamFallbackOnly = (node: JSXNode): Stream.Stream<string, Error> =>
  renderSSRNode(node, null);

/**
 * Progressively serializes an Effect-infused JSX tree (`JSXNode`) into a stream
 * of HTML string chunks, in render-tree order.
 *
 * `<Suspense>` boundaries are fully supported: the fallback is emitted inline
 * between `<!-- suspense-start-N -->` / `<!-- suspense-end-N -->` comment
 * markers; a `<template>+<script>` patch chunk is appended after the main
 * document structure as each boundary resolves. The stream terminates only
 * after all pending boundaries have emitted their patch.
 */
export const renderToStream = (node: JSXNode): Stream.Stream<string, Error> =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const patchQueue = yield* Queue.unbounded<string>();
      const pendingCount = yield* Ref.make(0);
      const idCounter = { current: 0 };
      const scope = yield* Effect.scope;
      const ctx: ServerSuspenseCtx = { patchQueue, pendingCount, idCounter, scope };

      const mainStream = renderSSRNode(node, ctx).pipe(
        // After the main document tree is exhausted: if no <Suspense> was
        // encountered (pendingCount still 0), shut down the queue immediately
        // so the patch stream terminates without hanging (AC-SS7).
        Stream.ensuring(
          Ref.get(pendingCount).pipe(
            Effect.flatMap((n) => (n === 0 ? Queue.shutdown(patchQueue) : Effect.void)),
          ),
        ),
      );

      return Stream.concat(mainStream, Stream.fromQueue(patchQueue));
    }),
  );

/**
 * Like {@link renderToStream}, but wraps each reactive (`Stream`/`Effect`)
 * region in `<!-- stream-start-N -->` … `<!-- stream-end-N -->` comment markers
 * so the client `hydrate` can locate reactive regions. Suspense streaming
 * patches include these markers in the resolved children HTML (AC-SS3).
 */
export const renderToStreamHydratable = (node: JSXNode): Stream.Stream<string, Error> =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const patchQueue = yield* Queue.unbounded<string>();
      const pendingCount = yield* Ref.make(0);
      const idCounter = { current: 0 };
      const scope = yield* Effect.scope;
      const ctx: ServerSuspenseCtx = { patchQueue, pendingCount, idCounter, scope };
      const counter: RegionCounter = { current: 0 };

      const mainStream = renderHydratableSSRNode(node, counter, ctx).pipe(
        Stream.ensuring(
          Ref.get(pendingCount).pipe(
            Effect.flatMap((n) => (n === 0 ? Queue.shutdown(patchQueue) : Effect.void)),
          ),
        ),
      );

      return Stream.concat(mainStream, Stream.fromQueue(patchQueue));
    }),
  );
