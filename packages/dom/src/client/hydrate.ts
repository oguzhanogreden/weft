import { FRAGMENT } from "@effect-ui/core/jsx-runtime";
import { Suspense } from "@effect-ui/core/suspense";
import type { JSXNode } from "@effect-ui/core/types";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import type { MountHandle } from "./api";
import {
  HydrationMismatchError,
  UnsupportedNodeTypeError,
  type RenderError,
  type StreamSubscriptionError,
} from "~/data";
import { setElementProps } from "./dom";
import { parseStreamMarker } from "./markers";
import { RenderContext } from "~/data";
import { updateStreamChild } from "./render-core";
import { isStream, normalizeToStream } from "~/utilities";

/**
 * Continues, on the client, the DOM produced on the server by
 * `renderToStringHydratable`/`renderToStreamHydratable`.
 *
 * Unlike {@link mount}, `hydrate` does **not** clear the root: it walks the JSX
 * tree in lockstep with the existing server DOM, adopting nodes in place,
 * attaching event handlers and reactive subscriptions without re-creating the
 * static structure. Reactive (`Stream`/`Effect`) regions are located via the
 * `<!-- stream-start-N -->` / `<!-- stream-end-N -->` comment markers emitted by
 * the hydratable server renderer. The stream's **first** emission is hydrated
 * against that server-rendered content in place (no re-render, node identity
 * preserved); only subsequent emissions patch the region — see
 * `hydrate.specs.md`.
 *
 * Shares {@link mount}'s lifecycle: a fresh `ManagedRuntime` per call, a `Scope`
 * owning all forked subscriptions, and a {@link MountHandle} for teardown.
 *
 * @param app - JSX tree to hydrate (must match the tree rendered on the server)
 * @param root - HTMLElement whose children were produced by the server renderer
 * @returns Effect that yields a MountHandle for cleanup
 *
 * @example
 * ```tsx
 * const root = document.getElementById("root")!;
 * // root.innerHTML already contains server output
 * const handle = await Effect.runPromise(hydrate(<App />, root));
 * ```
 */
export function hydrate(
  app: JSXNode,
  root: HTMLElement,
): Effect.Effect<
  MountHandle,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError | HydrationMismatchError
> {
  return Effect.gen(function* () {
    // Capture current Effect context so event handlers can access provided services.
    const effectContext = yield* Effect.context<never>();

    const runtime = ManagedRuntime.make(Layer.succeedContext(effectContext));
    const scope = yield* Scope.make();

    const context = {
      runtime,
      scope,
      streamIdCounter: { current: 0 },
    };

    // AC28: Cleanup effect — runs only on failure to avoid leaking runtime/scope
    const cleanup = Effect.zipRight(
      Scope.close(scope, Exit.void),
      Effect.promise(() => runtime.dispose()),
    );

    // Adopt the existing server DOM rather than clearing the root.
    // AC28: tapError ensures runtime/scope are disposed if hydrateNode fails
    yield* hydrateNode(app, root.firstChild, "root").pipe(
      Effect.provideService(RenderContext, context),
      Effect.tapError(() => cleanup),
    );

    let unmounted = false;

    return {
      unmount: () =>
        Effect.gen(function* () {
          if (unmounted) {
            return;
          }
          unmounted = true;
          yield* Scope.close(scope, Exit.void);
          yield* Effect.promise(() => runtime.dispose());
        }),
    } satisfies MountHandle;
  });
}

// ============================================================================
// Adopt walk
// ============================================================================

type HydrateError =
  | UnsupportedNodeTypeError
  | StreamSubscriptionError
  | RenderError
  | HydrationMismatchError;

/**
 * Hydrates a single JSXNode against the DOM, consuming the node(s) starting at
 * `cursor` and returning the next unconsumed sibling.
 */
function hydrateNode(
  node: JSXNode,
  cursor: ChildNode | null,
  path: string,
): Effect.Effect<ChildNode | null, HydrateError, RenderContext> {
  return Effect.gen(function* () {
    // Primitives that render text
    if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
      return yield* hydrateText(String(node), cursor, path);
    }

    // boolean/null/undefined render nothing — consume no DOM
    if (typeof node === "boolean" || node === null || node === undefined) {
      return cursor;
    }

    // Reactive region (checked before iterables, since a Stream may be iterable)
    if (isStream(node) || Effect.isEffect(node)) {
      return yield* hydrateReactive(
        normalizeToStream(node) as Stream.Stream<JSXNode>,
        cursor,
        path,
      );
    }

    // Iterables: hydrate children in order, threading the cursor
    if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
      let next = cursor;
      let index = 0;
      for (const child of node as Iterable<JSXNode>) {
        next = yield* hydrateNode(child, next, `${path}[${index}]`);
        index++;
      }
      return next;
    }

    // JSX elements: { type, props }
    if (typeof node === "object" && "type" in node && !(Symbol.iterator in node)) {
      const element = node as { type: unknown; props: object };
      const { type, props } = element;

      if (type === FRAGMENT) {
        return yield* hydrateChildren(props, cursor, path);
      }

      if (type === Suspense) {
        // By the time `hydrate` runs, the SSR patch script has already resolved
        // the boundary: the fallback is gone and the children are inline in the
        // DOM. Hydrate the children directly from the current cursor — the
        // Suspense wrapper is transparent to the DOM walk.
        return yield* hydrateChildren(props, cursor, path);
      }

      if (typeof type === "string") {
        return yield* hydrateElement(type, props, cursor, path);
      }

      if (typeof type === "function") {
        // Components are ephemeral: call once, hydrate the result in place.
        const result = (type as (props: object) => JSXNode)(props);
        return yield* hydrateNode(result, cursor, path);
      }

      return yield* Effect.fail(
        new UnsupportedNodeTypeError({
          type,
          message: `Invalid JSXNode type during hydration at ${path}: expected string, FRAGMENT, or function, got ${typeof type}`,
        }),
      );
    }

    return cursor;
  });
}

/**
 * Hydrates a text value. Adjacent text children coalesce into a single DOM text
 * node, so when the node is longer than the expected string it is split with
 * `Text.splitText` and the tail left for the next sibling.
 */
function hydrateText(
  expected: string,
  cursor: ChildNode | null,
  path: string,
): Effect.Effect<ChildNode | null, HydrateError, RenderContext> {
  return Effect.gen(function* () {
    // Empty string contributes no DOM node (the server emits nothing).
    if (expected.length === 0) {
      return cursor;
    }

    if (cursor === null || cursor.nodeType !== TEXT_NODE) {
      return yield* mismatch(`text ${JSON.stringify(expected)}`, describeNode(cursor), path);
    }

    const textNode = cursor as Text;
    if (!textNode.data.startsWith(expected)) {
      return yield* mismatch(`text ${JSON.stringify(expected)}`, describeNode(cursor), path);
    }

    // Coalesced text node holds more than this child: split off the remainder.
    if (textNode.data.length > expected.length) {
      return textNode.splitText(expected.length);
    }

    return textNode.nextSibling;
  });
}

/**
 * Hydrates a reactive region: pairs the start/end markers around the
 * server-rendered content, then subscribes to the stream. The **first** emission
 * is hydrated against the adopted content in place (see {@link hydrateFirstEmission});
 * subsequent emissions patch the region via {@link updateStreamChild}.
 */
function hydrateReactive(
  stream: Stream.Stream<JSXNode>,
  cursor: ChildNode | null,
  path: string,
): Effect.Effect<ChildNode | null, HydrateError, RenderContext> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;

    if (cursor === null || cursor.nodeType !== COMMENT_NODE) {
      return yield* mismatch("reactive region start marker", describeNode(cursor), path);
    }
    const startMarker = cursor as Comment;
    const parsed = parseStreamMarker(startMarker);
    if (parsed === null || parsed.kind !== "start") {
      return yield* mismatch("reactive region start marker", describeNode(cursor), path);
    }

    const endMarker = findMatchingEnd(startMarker);
    if (endMarker === null) {
      return yield* mismatch(
        "reactive region end marker",
        `unterminated region starting at ${JSON.stringify(startMarker.data)}`,
        path,
      );
    }

    // The first emission was server-rendered: hydrate it against the adopted
    // content (flash-free). Later emissions are client-rendered: patch via the
    // shared update flow. Forked into the mount scope.
    let isFirst = true;
    const effect = Stream.runForEach(stream, (value) =>
      (isFirst
        ? ((isFirst = false), hydrateFirstEmission(value, startMarker, endMarker, path))
        : updateStreamChild(startMarker, endMarker, value)
      ).pipe(Effect.provideService(RenderContext, context)),
    );
    yield* Effect.forkIn(effect, context.scope);

    return endMarker.nextSibling;
  });
}

/**
 * Hydrates a reactive region's first (server-rendered) emission against the DOM
 * already present between its markers, reusing the adopt-walk. If the adopted
 * content exactly matches the emission (cursor lands on the end marker), nothing
 * is mutated — node identity is preserved and there is no flash. If it diverges
 * (a `HydrationMismatchError`, or the walk doesn't consume the whole region), the
 * region is patched via {@link updateStreamChild} as a recoverable fallback and a
 * `console.error` is logged.
 */
function hydrateFirstEmission(
  value: JSXNode,
  startMarker: Comment,
  endMarker: Comment,
  path: string,
): Effect.Effect<void, HydrateError, RenderContext> {
  return Effect.gen(function* () {
    // `null` => the adopted content exactly matched the first emission;
    // a string => the reason it diverged (logged before patching).
    const divergence = yield* hydrateNode(value, startMarker.nextSibling, `${path}<resume>`).pipe(
      Effect.map((nextCursor) =>
        nextCursor === endMarker ? null : "adopted content did not align with the end marker",
      ),
      Effect.catchTag("HydrationMismatchError", (error) =>
        Effect.succeed(`expected ${error.expected}, found ${error.actual} at ${error.path}`),
      ),
    );

    if (divergence === null) {
      return; // flash-free: nothing mutated, node identity preserved.
    }

    // Diverged from the server output: patch to the correct first value.
    console.error(
      `[effect-ui] hydrate: reactive region at ${path} diverged from server output (${divergence}); patching.`,
    );
    yield* updateStreamChild(startMarker, endMarker, value);
  });
}

/**
 * Hydrates a string-typed element: matches the tag, re-applies props (attaching
 * event handlers and reactive subscriptions; static attributes are idempotent),
 * then hydrates the element's children.
 */
function hydrateElement(
  type: string,
  props: object,
  cursor: ChildNode | null,
  path: string,
): Effect.Effect<ChildNode | null, HydrateError, RenderContext> {
  return Effect.gen(function* () {
    if (cursor === null || cursor.nodeType !== ELEMENT_NODE) {
      return yield* mismatch(`<${type}>`, describeNode(cursor), path);
    }

    const element = cursor as HTMLElement;
    if (element.tagName.toLowerCase() !== type.toLowerCase()) {
      return yield* mismatch(`<${type}>`, describeNode(cursor), path);
    }

    // Re-apply props in place: event handlers attach, reactive props subscribe,
    // static attributes are set idempotently.
    yield* setElementProps(element, props);

    yield* hydrateChildren(props, element.firstChild, `${path} > ${type}`);

    return element.nextSibling;
  });
}

/**
 * Hydrates the `children` prop of an element or fragment against the DOM nodes
 * starting at `cursor`.
 */
function hydrateChildren(
  props: object,
  cursor: ChildNode | null,
  path: string,
): Effect.Effect<ChildNode | null, HydrateError, RenderContext> {
  return Effect.gen(function* () {
    const children = "children" in props ? (props as { children?: unknown }).children : undefined;

    if (children === undefined) {
      return cursor;
    }

    const childArray = Array.isArray(children) ? children : [children];
    let next = cursor;
    let index = 0;
    for (const child of childArray) {
      next = yield* hydrateNode(child as JSXNode, next, `${path}[${index}]`);
      index++;
    }
    return next;
  });
}

// ============================================================================
// DOM helpers
// ============================================================================

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

/**
 * Walks forward from a start marker to its depth-matched end marker, accounting
 * for nested reactive regions. Returns `null` if no matching end is found.
 */
function findMatchingEnd(startMarker: Comment): Comment | null {
  let depth = 0;
  let current: ChildNode | null = startMarker.nextSibling;

  while (current !== null) {
    if (current.nodeType === COMMENT_NODE) {
      const marker = parseStreamMarker(current as Comment);
      if (marker !== null) {
        if (marker.kind === "start") {
          depth++;
        } else if (depth === 0) {
          return current as Comment;
        } else {
          depth--;
        }
      }
    }
    current = current.nextSibling;
  }

  return null;
}

/**
 * Renders a short description of a DOM node for mismatch diagnostics.
 */
function describeNode(node: ChildNode | null): string {
  if (node === null) {
    return "end of children";
  }
  switch (node.nodeType) {
    case ELEMENT_NODE:
      return `<${(node as Element).tagName.toLowerCase()}>`;
    case TEXT_NODE:
      return `text ${JSON.stringify((node as Text).data)}`;
    case COMMENT_NODE:
      return `comment ${JSON.stringify((node as Comment).data)}`;
    default:
      return `node(type ${node.nodeType})`;
  }
}

function mismatch(
  expected: string,
  actual: string,
  path: string,
): Effect.Effect<never, HydrationMismatchError> {
  return Effect.fail(new HydrationMismatchError({ expected, actual, path }));
}
