import {
  Deferred,
  Effect,
  ExecutionStrategy,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  Ref,
  Scope,
  Stream,
  pipe,
} from "effect";
import { FRAGMENT } from "@effect-ui/core";
import { isStream, Suspense, toStream } from "@effect-ui/core";
import type { SuspenseProps } from "@effect-ui/core";
import type { RenderNode } from "@effect-ui/core/types";
import {
  HydrationMismatchError,
  UnsupportedNodeTypeError,
  type RenderError,
  type RenderResult,
  type StreamSubscriptionError,
  RenderContext,
  SuspenseContext,
} from "~/data";
import {
  parseStreamMarker,
  streamEndText,
  streamStartText,
  suspenseEndText,
  suspenseStartText,
} from "~/shared";
import { nextStreamId, nextSuspenseId } from "~/utilities";

// ============================================================================
// DOM Prop Handling
// ============================================================================

/**
 * Checks if a prop name is an event handler (starts with "on" + lowercase letter)
 */
function isEventHandler(name: string): boolean {
  if (name.length <= 2 || !name.startsWith("on")) {
    return false;
  }
  const thirdChar = name[2];
  // Must be a lowercase letter (a-z), not a number or uppercase
  return thirdChar !== undefined && thirdChar >= "a" && thirdChar <= "z";
}

/**
 * Sets all props on an element (attributes, properties, styles)
 */
export function setElementProps(
  element: HTMLElement,
  props: object,
): Effect.Effect<void, StreamSubscriptionError, RenderContext> {
  return Effect.gen(function* () {
    for (const [key, value] of Object.entries(props)) {
      // AC7: Skip children prop
      if (key === "children") {
        continue;
      }

      // Event handlers (onclick, onchange, etc.)
      if (isEventHandler(key)) {
        yield* setEventHandler(element, key, value);
        continue;
      }

      if (key === "ref" && typeof value === "object" && Ref.RefTypeId in value) {
        yield* Ref.set(value, Option.some(element));
        continue;
      }

      // AC10-AC13: Special handling for style
      if (key === "style") {
        yield* handleStyle(element, value);
        continue;
      }

      // AC7: Determine if property or attribute
      if (isProperty(element, key)) {
        yield* setProperty(element, key, value);
      } else {
        yield* setAttribute(element, key, value);
      }
    }
  });
}

/**
 * Determines if a prop should be set as property vs attribute
 */
function isProperty(element: HTMLElement, name: string): boolean {
  // AC7: data-* and aria-* always treated as attributes
  if (name.startsWith("data-") || name.startsWith("aria-")) {
    return false;
  }

  // AC7: Check prototype chain
  let proto = Object.getPrototypeOf(element);
  while (proto !== null) {
    if (Object.hasOwn(proto, name)) {
      return true;
    }
    proto = Object.getPrototypeOf(proto);
  }

  return name in element;
}

/**
 * Sets a property on an element (or subscribes to stream)
 */
function setProperty(
  element: HTMLElement,
  name: string,
  value: unknown,
): Effect.Effect<void, StreamSubscriptionError, RenderContext> {
  return Effect.gen(function* () {
    // AC14: Normalize Effect/Stream
    if (isStream(value) || Effect.isEffect(value)) {
      const stream = toStream(value);
      yield* subscribeToStream(
        stream,
        (val) => {
          // AC15: null/undefined removes property
          if (val === null || val === undefined) {
            delete (element as unknown as Record<string, unknown>)[name];
          } else {
            (element as unknown as Record<string, unknown>)[name] = val;
          }
        },
        `property:${name}`,
      );
    } else {
      // Static value
      if (value !== null && value !== undefined) {
        (element as unknown as Record<string, unknown>)[name] = value;
      }
    }
  });
}

/**
 * Sets an attribute on an element (or subscribes to stream)
 */
function setAttribute(
  element: HTMLElement,
  name: string,
  value: unknown,
): Effect.Effect<void, StreamSubscriptionError, RenderContext> {
  return Effect.gen(function* () {
    // AC14: Normalize Effect/Stream
    if (isStream(value) || Effect.isEffect(value)) {
      const stream = toStream(value);
      yield* subscribeToStream(
        stream,
        (val) => {
          // AC15: null/undefined removes attribute
          if (val === null || val === undefined) {
            element.removeAttribute(name);
          } else {
            const serialized = serializeAttributeValue(val);
            if (serialized !== undefined) {
              // AC8: Boolean attributes
              if (typeof val === "boolean") {
                if (val) {
                  element.setAttribute(name, "");
                } else {
                  element.removeAttribute(name);
                }
              } else {
                element.setAttribute(name, serialized);
              }
            }
          }
        },
        `attribute:${name}`,
      );
    } else {
      // Static value
      const serialized = serializeAttributeValue(value);
      if (serialized !== undefined) {
        // AC8: Boolean attributes
        if (typeof value === "boolean") {
          if (value) {
            element.setAttribute(name, "");
          } else {
            element.removeAttribute(name);
          }
        } else {
          element.setAttribute(name, serialized);
        }
      }
    }
  });
}

/**
 * Serializes attribute value to string
 */
function serializeAttributeValue(value: unknown): string | undefined {
  // AC9: undefined and null -> skip
  if (value === undefined || value === null) {
    return undefined;
  }

  // AC9: Convert to string
  // oxlint-disable-next-line typescript/no-base-to-string
  return String(value);
}

/**
 * Handles style attribute (string, object, or stream)
 */
function handleStyle(
  element: HTMLElement,
  value: unknown,
): Effect.Effect<void, StreamSubscriptionError, RenderContext> {
  return Effect.gen(function* () {
    // AC13: Stream of styles
    if (isStream(value) || Effect.isEffect(value)) {
      const stream = toStream(value);
      yield* subscribeToStream(
        stream,
        (val) => {
          // AC13: String -> setAttribute
          if (typeof val === "string") {
            element.setAttribute("style", val);
          }
          // AC13: Object -> replace all properties
          else if (typeof val === "object" && val !== null) {
            // Clear existing styles
            element.style.cssText = "";
            // Set new styles
            for (const [key, styleValue] of Object.entries(val)) {
              if (styleValue !== undefined && styleValue !== null) {
                element.style.setProperty(camelToKebab(key), String(styleValue));
              }
            }
          }
        },
        "style",
      );
      return;
    }

    // AC10: String form
    if (typeof value === "string") {
      element.setAttribute("style", value);
      return;
    }

    // AC11-AC12: Object form
    if (typeof value === "object" && value !== null) {
      yield* setStyleFromObject(element, value as Record<string, unknown>);
    }
  });
}

/**
 * Sets style from object form
 */
function setStyleFromObject(
  element: HTMLElement,
  styleObj: Record<string, unknown>,
): Effect.Effect<void, StreamSubscriptionError, RenderContext> {
  return Effect.gen(function* () {
    for (const [key, value] of Object.entries(styleObj)) {
      // AC12: Handle stream properties
      if (isStream(value) || Effect.isEffect(value)) {
        const stream = toStream(value);
        yield* subscribeToStream(
          stream,
          (val) => {
            if (val !== undefined && val !== null) {
              // oxlint-disable-next-line typescript/no-base-to-string
              element.style.setProperty(camelToKebab(key), String(val));
            }
          },
          `style.${key}`,
        );
      } else {
        // AC11: Static style property
        if (value !== undefined && value !== null) {
          // oxlint-disable-next-line typescript/no-base-to-string
          element.style.setProperty(camelToKebab(key), String(value));
        }
      }
    }
  });
}

/**
 * Converts camelCase to kebab-case for CSS properties
 */
function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Subscribes to a stream and runs callback for each emission
 */
function subscribeToStream<A>(
  stream: Stream.Stream<A>,
  onValue: (value: A) => void | Promise<void>,
  _errorContext: string,
): Effect.Effect<void, StreamSubscriptionError, RenderContext> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;

    // Create the stream subscription effect
    const effect = Stream.runForEach(stream, (value) => Effect.sync(() => void onValue(value)));

    // Fork the effect in the scope so it's automatically interrupted when scope closes
    yield* Effect.forkIn(effect, context.scope);

    // Note: Stream runs in background via forked fiber
    // This matches the AC1 requirement that Effect completes after initial render
    // and streams run in background
  });
}

/**
 * Sets an event handler on an element (supports static, Stream, and Effect handlers)
 */
function setEventHandler(
  element: HTMLElement,
  name: string,
  value: unknown,
): Effect.Effect<void, StreamSubscriptionError, RenderContext> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;
    const eventName = name.slice(2).toLowerCase();

    // Track current listener for cleanup
    let currentListener: ((e: Event) => void) | null = null;

    const removeListener = () => {
      if (currentListener) {
        element.removeEventListener(eventName, currentListener);
        currentListener = null;
      }
    };

    const attachListener = (handler: unknown) => {
      // Remove previous listener if any
      removeListener();

      // null/false/undefined = no handler
      if (handler == null || handler === false) {
        return;
      }

      if (typeof handler !== "function") {
        return; // Invalid handler, ignore
      }

      // Create wrapper that detects Effect return values
      currentListener = (event: Event) => {
        const result = handler(event);
        if (Effect.isEffect(result)) {
          context.runtime.runFork(
            pipe(
              result as Effect.Effect<void, unknown, never>,
              Effect.catchAll((error) => {
                if (process.env.NODE_ENV !== "development") {
                  return Effect.void;
                }
                return Effect.logError(`Event handler error: ${name}`, { error });
              }),
            ),
          );
        }
      };

      element.addEventListener(eventName, currentListener);
    };

    // Register cleanup finalizer with scope
    yield* Scope.addFinalizer(context.scope, Effect.sync(removeListener));

    // Handle static vs reactive handlers
    if (isStream(value) || Effect.isEffect(value)) {
      const stream = toStream(value);
      yield* subscribeToStream(stream, (handler) => attachListener(handler), `event:${name}`);
    } else {
      // Static handler
      attachListener(value);
    }
  });
}

// ============================================================================
// Suspense Boundary
// ============================================================================

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
function renderSuspenseBoundary(
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
        n <= 0 ? Effect.asVoid(Deferred.succeed(allSettled, undefined)) : Effect.void,
      ),
    );

    const suspenseService = {
      register: Ref.update(pendingRef, (n) => n + 1),
      settle,
    };

    // ── 4. Render children with SuspenseContext in scope ─────────────────────
    const rawChildren = props.children;
    const childArray: readonly RenderNode[] =
      rawChildren === undefined
        ? []
        : Array.isArray(rawChildren)
          ? (rawChildren as readonly RenderNode[])
          : [rawChildren as RenderNode];

    // Wrap direct Effect/Stream children in function-component descriptors so
    // they go through renderComponent and register/settle with this boundary.
    // Static element nodes ({type, props}) are passed through unchanged.
    const suspenseChildren = childArray.map((child): RenderNode => {
      if (Effect.isEffect(child) || isStream(child)) {
        const fn = (): RenderNode => child;
        return { type: fn, props: {} };
      }
      return child;
    });

    // renderNode handles arrays via its iterable branch → returns readonly Node[]
    const childResult = yield* renderNode(suspenseChildren as RenderNode).pipe(
      Effect.provideService(SuspenseContext, suspenseService),
    );

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
    const fallbackResult = yield* renderNode((props.fallback ?? null) as RenderNode);
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

// ============================================================================
// Core Renderer
// ============================================================================

/**
 * Main rendering function that converts RenderNode to DOM nodes.
 * Handles all RenderNode types and sets up reactive subscriptions.
 */
export function renderNode(
  node: RenderNode,
): Effect.Effect<
  RenderResult,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    // AC2: Handle primitives
    if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
      return document.createTextNode(String(node));
    }

    // AC2: Boolean, null, undefined, void -> render nothing
    if (typeof node === "boolean" || node === null || node === undefined) {
      return null;
    }

    // Check for Stream/Effect first (before iterables, since Stream might be iterable)
    if (isStream(node) || Effect.isEffect(node)) {
      // h.* nodes use Effect.sync and can be rendered inline without fork/markers.
      // Truly async Effects (user components, timers) will throw and fall through.
      if (Effect.isEffect(node)) {
        try {
          return yield* renderNode(Effect.runSync(node as Effect.Effect<RenderNode, never, never>));
        } catch {
          // Async Effect — use fork + stream markers below
        }
      }
      const stream = toStream(node);
      const markers = yield* handleStreamChild(stream);
      return markers;
    }

    // AC3: Handle iterables (including arrays)
    if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
      const flattened = flattenChildren(node);
      return yield* renderChildren(flattened);
    }

    // Handle JSX elements: { type, props }
    if (typeof node === "object" && "type" in node && !(Symbol.iterator in node)) {
      const element = node as { type: unknown; props: object };
      const { type, props } = element;

      // AC6: Fragment
      if (type === FRAGMENT) {
        return yield* renderFragment(props);
      }

      // Suspense boundary
      if (type === Suspense) {
        return yield* renderSuspenseBoundary(props as unknown as SuspenseProps);
      }

      // AC4: Element (string type)
      if (typeof type === "string") {
        return yield* renderElement(type, props);
      }

      // AC5: Function component
      if (typeof type === "function") {
        return yield* renderComponent(type as (props: object) => RenderNode, props);
      }

      // AC23: Invalid element type
      return yield* Effect.fail(
        new UnsupportedNodeTypeError({
          type,
          message: `Invalid RenderNode type: expected string, FRAGMENT, or function, got ${typeof type}`,
        }),
      );
    }

    // Shouldn't reach here, but handle gracefully
    return null;
  });
}

/**
 * Flattens iterable children recursively
 */
function flattenChildren(node: RenderNode): readonly RenderNode[] {
  const result: RenderNode[] = [];

  function flatten(item: RenderNode): void {
    // Don't try to iterate streams/effects
    if (isStream(item) || Effect.isEffect(item)) {
      result.push(item);
      return;
    }

    if (typeof item === "object" && item !== null && Symbol.iterator in item && !("type" in item)) {
      for (const child of item as Iterable<RenderNode>) {
        flatten(child);
      }
    } else {
      result.push(item);
    }
  }

  flatten(node);
  return result;
}

/**
 * Renders an array of children nodes
 */
function renderChildren(
  children: readonly RenderNode[],
): Effect.Effect<
  readonly Node[],
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    const nodes: Node[] = [];

    for (const child of children) {
      // Check if child is a stream/effect and handle specially
      if (isStream(child) || Effect.isEffect(child)) {
        const stream = toStream(child) as Stream.Stream<RenderNode>;
        const markers = yield* handleStreamChild(stream);
        nodes.push(...markers);
      } else {
        const result = yield* renderNode(child);

        if (result !== null) {
          if (Array.isArray(result)) {
            nodes.push(...result);
          } else {
            nodes.push(result as Node);
          }
        }
      }
    }

    return nodes;
  });
}

/**
 * Renders a fragment RenderNode (type: FRAGMENT)
 */
function renderFragment(
  props: object,
): Effect.Effect<
  readonly Node[],
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    const children = "children" in props ? props.children : undefined;

    if (children === undefined) {
      return [];
    }

    const childArray = Array.isArray(children) ? children : [children];
    return yield* renderChildren(childArray);
  });
}

/**
 * Renders an element RenderNode (type: string)
 */
function renderElement(
  type: string,
  props: object,
): Effect.Effect<
  HTMLElement,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    // AC4: Create element using document.createElement
    const element = document.createElement(type);

    // AC4: Set attributes/props first
    yield* setElementProps(element, props);

    // AC4: Then append children
    const children = "children" in props ? props.children : undefined;

    if (children !== undefined) {
      const childArray = Array.isArray(children) ? children : [children];

      for (const child of childArray) {
        // Check if child is a stream/effect
        if (isStream(child) || Effect.isEffect(child)) {
          const stream = toStream(child) as Stream.Stream<RenderNode>;
          const markers = yield* handleStreamChild(stream);
          for (const marker of markers) {
            element.appendChild(marker);
          }
        } else {
          const result = yield* renderNode(child);
          if (result !== null) {
            if (Array.isArray(result)) {
              for (const node of result) {
                element.appendChild(node);
              }
            } else {
              element.appendChild(result as Node);
            }
          }
        }
      }
    }

    return element;
  });
}

/**
 * Renders a function component RenderNode (type: function)
 */
function renderComponent(
  component: (props: object) => RenderNode,
  props: object,
): Effect.Effect<
  RenderResult,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    // AC5: Call function once with props (ephemeral execution)
    const result = component(props);

    // AC5: Handle Effect<RenderNode> or Stream<RenderNode>
    if (isStream(result) || Effect.isEffect(result)) {
      const context = yield* RenderContext;

      // AC-10/12: Fork a per-instance child scope so that prop pump fibers
      // (spawned via Effect.forkScoped inside toSubscribable) are tied to this
      // component instance and not to the mount-level scope. The instance scope
      // is a child of context.scope — closing context.scope closes it too.
      const instanceScope = yield* Scope.fork(context.scope, ExecutionStrategy.sequential);
      const instanceContext = { ...context, scope: instanceScope };

      // Check whether this component is inside a Suspense boundary.
      const suspenseCtx = yield* Effect.serviceOption(SuspenseContext);
      let stream = toStream(result);

      if (Option.isSome(suspenseCtx)) {
        // Register before subscribing so the boundary knows about this child.
        yield* suspenseCtx.value.register;

        // Wrap the stream so `settle` is called exactly once — on the first
        // emission — and subsequent emissions pass through unchanged.
        stream = pipe(
          stream,
          Stream.zipWithIndex,
          Stream.flatMap(([value, index]) =>
            index === 0
              ? Stream.fromEffect(Effect.as(suspenseCtx.value.settle, value))
              : Stream.make(value),
          ),
        );
      }

      // AC22: Component returning stream treated as stream child.
      // Thread instanceScope as both the ambient Scope.Scope (satisfies
      // forkScoped inside the component body) and RenderContext.scope (so
      // nested handleStreamChild calls fork into instanceScope).
      return yield* handleStreamChild(stream).pipe(
        Effect.provideService(RenderContext, instanceContext),
        Effect.provideService(Scope.Scope, instanceScope),
      );
    }

    // AC5: Plain RenderNode
    return yield* renderNode(result);
  });
}

/**
 * Handles a child that is a Stream by setting up comment markers and subscriptions.
 *
 * AC-13/14: A fresh **content scope** is forked from `context.scope` for each
 * emission. The previous content scope is closed before the new one is opened,
 * so nested fibers/pumps from the previous emission are cancelled on re-emit
 * rather than accumulating. The subscription fiber itself lives in
 * `context.scope` (the enclosing scope), not in the content scope.
 */
function handleStreamChild(
  stream: Stream.Stream<RenderNode>,
): Effect.Effect<
  readonly Node[],
  StreamSubscriptionError | RenderError | UnsupportedNodeTypeError,
  RenderContext
> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;

    // AC19: Create comment markers
    const streamId = yield* nextStreamId();
    const [startMarker, endMarker] = createStreamMarkers(streamId);

    // Mutable slot: the content scope from the most recent emission.
    // Closed before each new emission so nested fibers don't accumulate.
    let currentContentScope: Scope.CloseableScope | null = null;

    // AC20: Set up subscription — one fiber per stream, content scope per emission.
    const effect = Stream.runForEach(stream, (value) =>
      Effect.gen(function* () {
        // Close the previous content scope (cancels any nested fibers/pumps).
        if (currentContentScope !== null) {
          yield* Scope.close(currentContentScope, Exit.void);
        }
        // Fork a fresh child scope for this emission from the enclosing scope.
        currentContentScope = yield* Scope.fork(context.scope, ExecutionStrategy.sequential);
        const contentContext = { ...context, scope: currentContentScope };

        // Render under the content scope: RenderContext.scope and Scope.Scope
        // both point at currentContentScope per the governing rule.
        yield* updateStreamChild(startMarker, endMarker, value).pipe(
          Effect.provideService(RenderContext, contentContext),
          Effect.provideService(Scope.Scope, currentContentScope),
        );
      }),
    );

    // Subscription fiber lives in the enclosing context.scope (not content scope).
    yield* Effect.forkIn(effect, context.scope);

    // AC19: Return markers to be inserted.
    // Content will be updated asynchronously by the daemon fiber.
    return [startMarker, endMarker] as const;
  });
}

/**
 * Creates start and end comment markers for stream child
 */
function createStreamMarkers(streamId: number): readonly [Comment, Comment] {
  const startMarker = document.createComment(streamStartText(streamId));
  const endMarker = document.createComment(streamEndText(streamId));
  return [startMarker, endMarker];
}

/**
 * Updates stream child content between markers. Removes the nodes currently
 * between the markers, renders `newNode`, and inserts the result before the end
 * marker. Exported for reuse by the hydrator, which drives the same update flow
 * against markers adopted from server HTML rather than freshly created ones.
 */
export function updateStreamChild(
  startMarker: Comment,
  endMarker: Comment,
  newNode: RenderNode,
): Effect.Effect<
  void,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    // AC20: Remove all nodes between markers
    removeNodesBetweenMarkers(startMarker, endMarker);

    // AC20: Render new node
    const result = yield* renderNode(newNode);

    // AC20: Insert new nodes between markers
    const parent = startMarker.parentNode;
    if (parent !== null) {
      if (result !== null) {
        if (Array.isArray(result)) {
          for (const node of result) {
            parent.insertBefore(node, endMarker);
          }
        } else {
          parent.insertBefore(result as Node, endMarker);
        }
      }
    }
  });
}

/**
 * Removes all nodes between start and end markers. Exported for reuse by the
 * hydrator.
 */
export function removeNodesBetweenMarkers(startMarker: Comment, endMarker: Comment): void {
  let current = startMarker.nextSibling;
  while (current !== null && current !== endMarker) {
    const next = current.nextSibling;
    current.remove();
    current = next;
  }
}

// ============================================================================
// Mount
// ============================================================================

/**
 * Cleanup handle returned from mount that allows unmounting
 */
export interface MountHandle {
  /**
   * Unmounts the rendered tree and cleans up all resources.
   * Returns an Effect that completes when cleanup is done.
   * Safe to call multiple times (idempotent).
   */
  unmount(): Effect.Effect<void>;
}

/**
 * Mounts a JSX tree to a DOM element with full reactive support.
 *
 * - Clears the root element's existing children
 * - Renders the JSX tree to DOM nodes
 * - Sets up reactive subscriptions for Stream/Effect values
 * - Returns Effect that completes after initial render (streams run in background)
 * - Creates a fresh ManagedRuntime per mount
 * - Returns a cleanup handle to unmount and dispose resources
 *
 * @param app - JSX tree to render
 * @param root - HTMLElement to mount to
 * @returns Effect that yields MountHandle for cleanup
 *
 * @example
 * ```tsx
 * const app = <div>Hello World</div>;
 * const root = document.getElementById("root")!;
 * const handle = await Effect.runPromise(mount(app, root));
 * // Later: cleanup
 * await Effect.runPromise(handle.unmount());
 * ```
 */
export function mount(
  app: RenderNode,
  root: HTMLElement,
): Effect.Effect<MountHandle, UnsupportedNodeTypeError | StreamSubscriptionError | RenderError> {
  return Effect.gen(function* () {
    // Capture current Effect context (includes any provided services)
    // This allows event handlers to access services provided via Effect.provide(layer)
    const effectContext = yield* Effect.context<never>();

    // AC24: Create fresh ManagedRuntime per mount with captured context
    const runtime = ManagedRuntime.make(Layer.succeedContext(effectContext));
    const scope = yield* Scope.make();

    // Create the RenderContext service implementation
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

    // AC1: Clear root element's existing children
    root.innerHTML = "";

    // AC1: Render the JSX tree with the provided context.
    // AC28: tapError ensures runtime/scope are disposed if renderNode fails.
    // Scope.Scope is provided alongside RenderContext so that any top-level
    // Component.gen body (which calls forkScoped) has an ambient scope to
    // fork its prop-pump fibers into.
    const result = yield* renderNode(app).pipe(
      Effect.provideService(RenderContext, context),
      Effect.provideService(Scope.Scope, scope),
      Effect.tapError(() => cleanup),
    );

    // AC1: Append rendered nodes to root
    if (result !== null) {
      if (Array.isArray(result)) {
        for (const node of result) {
          root.appendChild(node);
        }
      } else {
        root.appendChild(result as Node);
      }
    }

    // AC27: Return cleanup handle
    // Track if already unmounted for idempotency
    let unmounted = false;

    return {
      unmount: () =>
        Effect.gen(function* () {
          // AC27: Make unmount idempotent
          if (unmounted) {
            return;
          }
          unmounted = true;

          // AC26: Close scope to cancel all running streams
          // All fibers forked with Effect.forkIn will be automatically interrupted
          yield* Scope.close(scope, Exit.void);

          // AC26: Dispose the ManagedRuntime
          // ManagedRuntime.dispose returns a Promise, so we need to wrap it
          yield* Effect.promise(() => runtime.dispose());
        }),
    } satisfies MountHandle;
  });
}

// ============================================================================
// Hydrate
// ============================================================================

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
  app: RenderNode,
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
    // AC28: tapError ensures runtime/scope are disposed if hydrateNode fails.
    // Scope.Scope provided alongside RenderContext — same rule as mount.
    yield* hydrateNode(app, root.firstChild, "root").pipe(
      Effect.provideService(RenderContext, context),
      Effect.provideService(Scope.Scope, scope),
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
// Hydrate — adopt walk
// ============================================================================

type HydrateError =
  | UnsupportedNodeTypeError
  | StreamSubscriptionError
  | RenderError
  | HydrationMismatchError;

/**
 * Hydrates a single RenderNode against the DOM, consuming the node(s) starting at
 * `cursor` and returning the next unconsumed sibling.
 */
function hydrateNode(
  node: RenderNode,
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
      // h.* nodes are Effect.sync — run inline rather than treating as a reactive region.
      if (Effect.isEffect(node)) {
        try {
          return yield* hydrateNode(
            Effect.runSync(node as Effect.Effect<RenderNode, never, never>),
            cursor,
            path,
          );
        } catch {
          // Async Effect — fall through to reactive region handling
        }
      }
      return yield* hydrateReactive(toStream(node) as Stream.Stream<RenderNode>, cursor, path);
    }

    // Iterables: hydrate children in order, threading the cursor
    if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
      let next = cursor;
      let index = 0;
      for (const child of node as Iterable<RenderNode>) {
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
        const result = (type as (props: object) => RenderNode)(props);
        return yield* hydrateNode(result, cursor, path);
      }

      return yield* Effect.fail(
        new UnsupportedNodeTypeError({
          type,
          message: `Invalid RenderNode type during hydration at ${path}: expected string, FRAGMENT, or function, got ${typeof type}`,
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
  stream: Stream.Stream<RenderNode>,
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
    // shared update flow. Content scope is rotated per emission (same rule as
    // handleStreamChild) so nested fibers don't accumulate across re-emits.
    let isFirst = true;
    let currentContentScope: Scope.CloseableScope | null = null;
    const effect = Stream.runForEach(stream, (value) =>
      Effect.gen(function* () {
        if (currentContentScope !== null) {
          yield* Scope.close(currentContentScope, Exit.void);
        }
        currentContentScope = yield* Scope.fork(context.scope, ExecutionStrategy.sequential);
        const contentContext = { ...context, scope: currentContentScope };

        yield* (
          isFirst
            ? ((isFirst = false), hydrateFirstEmission(value, startMarker, endMarker, path))
            : updateStreamChild(startMarker, endMarker, value)
        ).pipe(
          Effect.provideService(RenderContext, contentContext),
          Effect.provideService(Scope.Scope, currentContentScope),
        );
      }),
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
  value: RenderNode,
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
      next = yield* hydrateNode(child as RenderNode, next, `${path}[${index}]`);
      index++;
    }
    return next;
  });
}

// ============================================================================
// DOM helpers (hydration)
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
