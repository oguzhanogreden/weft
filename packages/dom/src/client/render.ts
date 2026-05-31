import {
  Deferred,
  Effect,
  ExecutionStrategy,
  Exit,
  Fiber,
  HashMap,
  HashSet,
  Layer,
  ManagedRuntime,
  Option,
  Ref,
  Scope,
  Stream,
  pipe,
} from "effect";
import {
  FAILURE_BOUNDARY,
  FRAGMENT,
  getElementDescriptor,
  isStream,
  LIST,
  Source,
  SUSPENSE_BOUNDARY,
  toStream,
} from "@effect-ui/core";
import type { Boundary, ElementDescriptor, Renderable } from "@effect-ui/core";
import {
  BoundaryContext,
  HydrationMismatchError,
  UnsupportedNodeTypeError,
  RenderError,
  type RenderResult,
  type StreamSubscriptionError,
  RenderContext,
  SuspenseContext,
} from "~/data";
import {
  boundaryEndText,
  boundaryStartText,
  listItemEndText,
  listItemStartText,
  parseStreamMarker,
  streamEndText,
  streamStartText,
  suspenseEndText,
  suspenseStartText,
} from "~/shared";
import { nextBoundaryId, nextStreamId, nextSuspenseId } from "~/utilities";

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
 * Subscribes to a stream and runs callback for each emission.
 * If a `BoundaryContext` is present, stream failures are routed to it.
 */
function subscribeToStream<A>(
  stream: Stream.Stream<A>,
  onValue: (value: A) => void | Promise<void>,
  _errorContext: string,
): Effect.Effect<void, StreamSubscriptionError, RenderContext> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;
    const boundaryCtx = yield* Effect.serviceOption(BoundaryContext);

    const effect = Stream.runForEach(stream, (value) => Effect.sync(() => void onValue(value)));
    const fiber = yield* Effect.forkIn(effect, context.scope);

    // Route stream failures to the nearest BoundaryContext; swallow if none.
    yield* pipe(
      Fiber.await(fiber),
      Effect.flatMap((exit) =>
        Exit.isFailure(exit)
          ? Option.isSome(boundaryCtx)
            ? boundaryCtx.value.reportError(exit.cause)
            : Effect.void
          : Effect.void,
      ),
      Effect.forkIn(context.scope),
    );
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
 * Implements a `Boundary.*` error boundary for the DOM renderer.
 *
 * Renders the children in a forked subtree scope. Construction-time errors are
 * caught immediately; post-mount stream errors are routed via `BoundaryContext`
 * and trigger a DOM swap to the fallback returned by `props.match`.
 */
function renderBoundary(
  props: Boundary.FailureProps & { children: Renderable[] },
): Effect.Effect<
  readonly Node[],
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;
    const parentBoundary = yield* Effect.serviceOption(BoundaryContext);

    const id = nextBoundaryId();
    const startMarker = document.createComment(boundaryStartText(id));
    const endMarker = document.createComment(boundaryEndText(id));

    const subtreeScope = yield* Scope.fork(context.scope, ExecutionStrategy.sequential);
    const subtreeContext = { ...context, scope: subtreeScope };

    const errorDeferred = yield* Deferred.make<void, import("effect").Cause.Cause<unknown>>();

    const boundaryService: BoundaryContext["Type"] = {
      reportError: (cause) => Deferred.fail(errorDeferred, cause).pipe(Effect.asVoid),
    };

    const childNodes = yield* pipe(
      renderChildren(props.children as readonly Renderable[]),
      Effect.provideService(BoundaryContext, boundaryService),
      Effect.provideService(RenderContext, subtreeContext),
      Effect.provideService(Scope.Scope, subtreeScope),
      Effect.catchAllCause((cause) => {
        const fallbackNode = props.match(cause);
        if (fallbackNode === null) return Effect.failCause(cause);
        return pipe(
          Scope.close(subtreeScope, Exit.void),
          Effect.flatMap(() => renderNode(fallbackNode as Renderable)),
          Effect.map((n): readonly Node[] =>
            n === null ? [] : Array.isArray(n) ? (n as Node[]) : [n as Node],
          ),
        );
      }),
    );

    // Recovery fiber: awaits error deferred, swaps DOM on trigger
    const recoveryEffect = Effect.gen(function* () {
      const cause = yield* Deferred.await(errorDeferred).pipe(Effect.flip);
      const fallbackNode = props.match(cause);
      yield* Scope.close(subtreeScope, Exit.void);

      if (fallbackNode === null) {
        if (Option.isSome(parentBoundary)) {
          // Propagate to the nearest parent boundary (spec AC15).
          return yield* parentBoundary.value.reportError(cause);
        }
        // No parent boundary: surface as an unhandled boundary failure.
        return yield* Effect.logError("Unhandled error escaped the outermost Boundary", cause);
      }

      removeNodesBetweenMarkers(startMarker, endMarker);
      const fallbackNodes = yield* renderNode(fallbackNode as Renderable);
      const parent = endMarker.parentNode;
      if (parent !== null) {
        if (fallbackNodes !== null) {
          if (Array.isArray(fallbackNodes)) {
            for (const n of fallbackNodes as Node[]) {
              parent.insertBefore(n, endMarker);
            }
          } else {
            parent.insertBefore(fallbackNodes as Node, endMarker);
          }
        }
      }
    });

    yield* Effect.forkIn(recoveryEffect, context.scope);

    return [startMarker, ...childNodes, endMarker] as readonly Node[];
  });
}

/**
 * Implements the suspense boundary (`Boundary.suspend`) for the DOM renderer.
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
  props: Boundary.SuspenseProps & { children?: Renderable },
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
    const childArray: readonly Renderable[] =
      rawChildren === undefined
        ? []
        : Array.isArray(rawChildren)
          ? (rawChildren as readonly Renderable[])
          : [rawChildren as Renderable];

    // Wrap direct Effect/Stream children in function-component descriptors so
    // they go through renderComponent and register/settle with this boundary.
    // Static element nodes ({type, props}) are passed through unchanged.
    const suspenseChildren = childArray.map((child): Renderable => {
      if (Effect.isEffect(child) || isStream(child)) {
        const fn = (): Renderable => child;
        return { type: fn, props: {} };
      }
      return child;
    });

    // renderNode handles arrays via its iterable branch → returns readonly Node[]
    const childResult = yield* renderNode(suspenseChildren as Renderable).pipe(
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
    const fallbackResult = yield* renderNode((props.fallback ?? null) as Renderable);
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
 * Main rendering function that converts Renderable to DOM nodes.
 * Handles all Renderable types and sets up reactive subscriptions.
 */
export function renderNode(
  node: Renderable,
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
      // Static markup (h.*, h.fragment, Boundary.*) carries its descriptor — render
      // it directly, without executing the Effect.
      const descriptor = getElementDescriptor(node);
      if (descriptor !== undefined) {
        return yield* renderNode(descriptor);
      }
      // Untagged Effect: probe for synchronous resolution (e.g. a synchronous
      // Component.gen used directly as a child) so it renders inline. A genuinely
      // async Effect resolves to a failure exit (AsyncFiberException) and falls
      // through to the fork + stream-marker path below.
      if (Effect.isEffect(node)) {
        // @effect-diagnostics-next-line runEffectInsideEffect:off -- intentional sync probe
        const exit = Effect.runSyncExit(node as Effect.Effect<Renderable, never, never>);
        if (Exit.isSuccess(exit)) {
          return yield* renderNode(exit.value);
        }
      }
      const stream = toStream<Renderable>(node);
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
      if (type === SUSPENSE_BOUNDARY) {
        return yield* renderSuspenseBoundary(props as Boundary.SuspenseProps);
      }

      // Error boundary
      if (type === FAILURE_BOUNDARY) {
        return yield* renderBoundary(props as Boundary.FailureProps & { children: Renderable[] });
      }

      // Keyed list region (List.each)
      if (type === LIST) {
        return yield* renderList(props as ListProps);
      }

      // AC4: Element (string type)
      if (typeof type === "string") {
        return yield* renderElement(type, props);
      }

      // AC5: Function component
      if (typeof type === "function") {
        return yield* renderComponent(type as (props: object) => Renderable, props);
      }

      // AC23: Invalid element type
      return yield* Effect.fail(
        new UnsupportedNodeTypeError({
          type,
          message: `Invalid Renderable type: expected string, FRAGMENT, or function, got ${typeof type}`,
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
function flattenChildren(node: Renderable): readonly Renderable[] {
  const result: Renderable[] = [];

  function flatten(item: Renderable): void {
    // Don't try to iterate streams/effects
    if (isStream(item) || Effect.isEffect(item)) {
      result.push(item);
      return;
    }

    if (typeof item === "object" && item !== null && Symbol.iterator in item && !("type" in item)) {
      for (const child of item as Iterable<Renderable>) {
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
  children: readonly Renderable[],
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
        const stream = toStream<Renderable>(child);
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
 * Renders a fragment Renderable (type: FRAGMENT)
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
 * Renders an element Renderable (type: string)
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
          const stream = toStream<Renderable>(child);
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
 * Renders a function component Renderable (type: function)
 */
function renderComponent(
  component: (props: object) => Renderable,
  props: object,
): Effect.Effect<
  RenderResult,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    // AC5: Call function once with props (ephemeral execution)
    const result = component(props);

    // AC5: Handle Effect<Renderable> or Stream<Renderable>
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
      let stream = toStream<Renderable>(result);

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

    // AC5: Plain Renderable
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
  stream: Stream.Stream<Renderable>,
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
    const streamFiber = yield* Effect.forkIn(effect, context.scope);

    // Route stream child failures to the nearest BoundaryContext; swallow if none.
    const boundaryCtx = yield* Effect.serviceOption(BoundaryContext);
    yield* pipe(
      Fiber.await(streamFiber),
      Effect.flatMap((exit) =>
        Exit.isFailure(exit)
          ? Option.isSome(boundaryCtx)
            ? boundaryCtx.value.reportError(exit.cause)
            : Effect.void
          : Effect.void,
      ),
      Effect.forkIn(context.scope),
    );

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
 * Reconciles the region between the stream markers against `newNode`'s shape,
 * patching in place when the shape is unchanged rather than tearing down and
 * rebuilding (AC20, SP1–SP4). The new value's shape is read from its descriptor
 * / primitive type **before** rendering, so identity-preserving updates avoid
 * creating throwaway nodes and subscriptions:
 *
 * - **SP1/SP2** — text→text: the region holds one `Text` node and `newNode` is a
 *   `string`/`number`/`bigint` → update `.data` in place (only if it differs).
 * - **SP3** — same-tag element reuse: the region holds one `Element` whose tag
 *   matches `newNode`'s descriptor → reuse the node, re-apply props, recurse over
 *   children by position.
 * - **SP4** — fallback (any other shape change): remove the nodes between the
 *   markers, render `newNode`, and insert the result before the end marker.
 *
 * Content-scope rotation is owned by the caller (`handleStreamChild` /
 * `hydrateReactive`): it closes the previous emission's content scope before each
 * call, so SP3's re-applied props subscribe under a fresh scope and the prior
 * emission's prop subscriptions / event listeners are already torn down.
 *
 * Exported for reuse by the hydrator, which drives the same update flow against
 * markers adopted from server HTML rather than freshly created ones.
 */
export function updateStreamChild(
  startMarker: Comment,
  endMarker: Comment,
  newNode: Renderable,
): Effect.Effect<
  void,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    const only = startMarker.nextSibling;
    const isSingle = only !== null && only !== endMarker && only.nextSibling === endMarker;

    // SP1/SP2: text→text — patch the existing Text node in place.
    if (isSingle && only.nodeType === TEXT_NODE && isTextValue(newNode)) {
      const text = String(newNode);
      if ((only as Text).data !== text) {
        (only as Text).data = text;
      }
      return;
    }

    // SP3: same-tag element reuse — keep the node, re-apply props, recurse children.
    if (isSingle && only.nodeType === ELEMENT_NODE) {
      const descriptor = staticElementDescriptor(newNode);
      if (
        descriptor !== undefined &&
        typeof descriptor.type === "string" &&
        (only as Element).tagName.toLowerCase() === descriptor.type.toLowerCase()
      ) {
        yield* patchElementInPlace(only as HTMLElement, descriptor);
        return;
      }
    }

    // SP4: fallback — remove all nodes between markers, render, and insert.
    removeNodesBetweenMarkers(startMarker, endMarker);
    const result = yield* renderNode(newNode);
    const parent = startMarker.parentNode;
    if (parent !== null && result !== null) {
      if (Array.isArray(result)) {
        for (const node of result) {
          parent.insertBefore(node, endMarker);
        }
      } else {
        parent.insertBefore(result as Node, endMarker);
      }
    }
  });
}

/** Narrows a Renderable to the primitive values that render as a single Text node. */
function isTextValue(value: Renderable): value is string | number | bigint {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint";
}

/**
 * Reads the static {@link ElementDescriptor} a Renderable resolves to without
 * executing anything: a static-markup `Node` (carries its descriptor) or a bare
 * descriptor object. Returns `undefined` for primitives, iterables, and genuinely
 * reactive streams/effects (which have no statically-known shape).
 */
function staticElementDescriptor(node: Renderable): ElementDescriptor | undefined {
  const carried = getElementDescriptor(node);
  if (carried !== undefined) {
    return carried;
  }
  if (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    !(Symbol.iterator in node) &&
    !isStream(node) &&
    !Effect.isEffect(node)
  ) {
    return node as unknown as ElementDescriptor;
  }
  return undefined;
}

/**
 * SP3 element reuse: re-applies `descriptor.props` to a kept element (re-subscribing
 * reactive props under the caller's fresh content scope), then reconciles its
 * children. Children are patched positionally when each maps 1:1 to a single node
 * ({@link patchChildrenInPlace}); otherwise the element's children are rebuilt
 * wholesale, preserving the element node itself.
 */
function patchElementInPlace(
  element: HTMLElement,
  descriptor: ElementDescriptor,
): Effect.Effect<
  void,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    yield* setElementProps(element, descriptor.props);

    const children = descriptor.props["children"];
    const newChildren =
      children === undefined ? [] : Array.isArray(children) ? children : [children];

    const patched = yield* patchChildrenInPlace(element, newChildren as readonly Renderable[]);
    if (!patched) {
      while (element.firstChild !== null) {
        element.firstChild.remove();
      }
      yield* appendRenderedChildren(element, newChildren as readonly Renderable[]);
    }
  });
}

/**
 * Attempts an in-place positional patch of an element's children. Succeeds (returns
 * `true`, having patched) only when every new child maps to exactly one existing
 * DOM node of the matching kind — text→`Text`, same-tag element→`Element`. Any
 * mismatch (count, kind, multi-node child, reactive child) returns `false` having
 * mutated nothing, so the caller can rebuild cleanly. Element children recurse via
 * {@link patchElementInPlace}, preserving nested node identity.
 */
function patchChildrenInPlace(
  element: HTMLElement,
  newChildren: readonly Renderable[],
): Effect.Effect<
  boolean,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    const existing = Array.from(element.childNodes);
    if (existing.length !== newChildren.length) {
      return false;
    }

    // Validation pass (no mutation): every slot must be a 1:1, same-kind match.
    for (let i = 0; i < newChildren.length; i++) {
      const child = newChildren[i] as Renderable;
      const node = existing[i] as ChildNode;
      if (isTextValue(child)) {
        if (node.nodeType !== TEXT_NODE) {
          return false;
        }
      } else {
        const childDescriptor = staticElementDescriptor(child);
        if (
          childDescriptor === undefined ||
          typeof childDescriptor.type !== "string" ||
          node.nodeType !== ELEMENT_NODE ||
          (node as Element).tagName.toLowerCase() !== childDescriptor.type.toLowerCase()
        ) {
          return false;
        }
      }
    }

    // Apply pass: positions are stable (no inserts/removes at this level).
    for (let i = 0; i < newChildren.length; i++) {
      const child = newChildren[i] as Renderable;
      const node = existing[i] as ChildNode;
      if (isTextValue(child)) {
        const text = String(child);
        if ((node as Text).data !== text) {
          (node as Text).data = text;
        }
      } else {
        // Validated above: a static, string-typed, same-tag descriptor.
        const childDescriptor = staticElementDescriptor(child) as ElementDescriptor;
        yield* patchElementInPlace(node as HTMLElement, childDescriptor);
      }
    }

    return true;
  });
}

/**
 * Renders each child and appends it to `element`, mirroring {@link renderElement}'s
 * child loop. Used by {@link patchElementInPlace} to rebuild children when a
 * positional in-place patch is not possible.
 */
function appendRenderedChildren(
  element: HTMLElement,
  children: readonly Renderable[],
): Effect.Effect<
  void,
  UnsupportedNodeTypeError | StreamSubscriptionError | RenderError,
  RenderContext
> {
  return Effect.gen(function* () {
    for (const child of children) {
      if (isStream(child) || Effect.isEffect(child)) {
        const stream = toStream<Renderable>(child);
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
// Keyed list region (List.each)
// ============================================================================

/** Descriptor props carried by a `List.each` node (see `combinator/list.ts`). */
interface ListProps {
  readonly of: Source.Source<Iterable<unknown>>;
  readonly by?: (item: unknown, index: number) => unknown;
  readonly render: (item: unknown, index: number) => Renderable;
}

/**
 * A single keyed item rendered inside a `List.each` region. Its `scope` is forked
 * from the region scope and **persists across emissions** — it is closed only when
 * the item is removed or the region is torn down — which is what keeps per-item
 * subscription fibers (and therefore stream-driven content) alive while the item
 * survives reconciliation. See `client/list.specs.md`.
 */
interface ItemRecord {
  /** The reconciliation key (compared via Effect `Equal`, hashed via `Hash`). */
  readonly key: unknown;
  /** Per-item scope, forked from the region scope; persists across emissions. */
  readonly scope: Scope.CloseableScope;
  /** This item's opening comment marker (` list-item-start-<id> `). */
  readonly startMarker: Comment;
  /** This item's closing comment marker (` list-item-end-<id> `). */
  readonly endMarker: Comment;
  /** The DOM nodes rendered for this item, between (exclusive) its markers. */
  readonly nodes: readonly Node[];
}

/** Persistent reconciler state held across a region's emissions. */
interface ListState {
  /** Identity map: key → record. */
  readonly records: HashMap.HashMap<unknown, ItemRecord>;
  /** The keys in their last-rendered DOM order (drives LIS move computation). */
  readonly order: readonly unknown[];
}

/**
 * Renders a `List.each` keyed-list region.
 *
 * Unlike a generic reactive child ({@link handleStreamChild}), this path does
 * **not** rotate a single content scope per emission. It brackets the region with
 * the usual `stream-start`/`stream-end` markers, forks a persistent region scope,
 * normalizes `of` to a `Subscribable`, and reconciles each emission against a
 * persistent `HashMap<K, ItemRecord>` so surviving keys keep both their DOM nodes
 * and their running subscription fibers (only added/removed/moved items touch the
 * DOM). Source/reconcile failures are routed to the nearest `BoundaryContext`,
 * mirroring {@link handleStreamChild}.
 */
function renderList(
  props: ListProps,
): Effect.Effect<
  readonly Node[],
  StreamSubscriptionError | RenderError | UnsupportedNodeTypeError,
  RenderContext
> {
  return Effect.gen(function* () {
    const context = yield* RenderContext;
    const { of, by, render } = props;

    // Region brackets, located on each emission like any reactive child.
    const streamId = yield* nextStreamId();
    const [startMarker, endMarker] = createStreamMarkers(streamId);

    // Region scope: parent of every per-item scope and of the `of` pump fiber.
    // Forked from the enclosing scope so region teardown (SC3) cascades to all
    // item scopes when the enclosing render scope closes.
    const regionScope = yield* Scope.fork(context.scope, ExecutionStrategy.sequential);

    // Normalize `of` (static Iterable / Effect / Stream / Subscribable) and
    // subscribe to its `.changes`. The pump fiber lives in the region scope.
    const subscribable = yield* Source.toSubscribable(of).pipe(
      Effect.provideService(Scope.Scope, regionScope),
    );
    // E/R are satisfied by the captured runtime context; runtime failures still
    // surface via the subscription fiber's exit and are routed to a boundary.
    const changes = subscribable.changes as Stream.Stream<Iterable<unknown>>;

    // Persistent reconciler state across emissions.
    let state: ListState = { records: HashMap.empty(), order: [] };

    const effect = Stream.runForEach(changes, (iterable) =>
      Effect.gen(function* () {
        // KR6: materialize the iterable so iteration order is fixed for this emission.
        const items = Array.from(iterable);
        state = yield* reconcileList(items, by, render, state, regionScope, endMarker, context);
      }),
    );

    // Subscription fiber lives in the region scope; failures route to a boundary.
    const fiber = yield* Effect.forkIn(effect, regionScope);
    const boundaryCtx = yield* Effect.serviceOption(BoundaryContext);
    yield* pipe(
      Fiber.await(fiber),
      Effect.flatMap((exit) =>
        Exit.isFailure(exit)
          ? Option.isSome(boundaryCtx)
            ? boundaryCtx.value.reportError(exit.cause)
            : Effect.void
          : Effect.void,
      ),
      Effect.forkIn(context.scope),
    );

    return [startMarker, endMarker] as const;
  });
}

/**
 * Reconciles one emission of a `List.each` region against the previous
 * {@link ListState}, returning the next state. Vue 3 / Solid `<For>`-style:
 * duplicate-key guard (KR1), insert new keys (KR2), reuse persisted keys without
 * re-invoking `render` (KR3), remove dropped keys and close their scopes (KR4),
 * and reorder retained items with a longest-increasing-subsequence so only items
 * outside the LIS are moved (KR5).
 */
function reconcileList(
  items: readonly unknown[],
  by: ((item: unknown, index: number) => unknown) | undefined,
  render: (item: unknown, index: number) => Renderable,
  prev: ListState,
  regionScope: Scope.Scope,
  regionEnd: Comment,
  context: RenderContext["Type"],
): Effect.Effect<
  ListState,
  StreamSubscriptionError | RenderError | UnsupportedNodeTypeError,
  RenderContext
> {
  return Effect.gen(function* () {
    // 1. Project keys and guard duplicates *before* rendering anything (KR1).
    const keys: unknown[] = [];
    let seen = HashSet.empty<unknown>();
    for (let i = 0; i < items.length; i++) {
      const key = by === undefined ? items[i] : by(items[i], i);
      if (HashSet.has(seen, key)) {
        return yield* Effect.fail(
          new RenderError({
            cause: key,
            message: `List.each: duplicate key ${describeKey(key)} in a single emission; keys must be unique (set a stable \`by\`).`,
          }),
        );
      }
      seen = HashSet.add(seen, key);
      keys.push(key);
    }

    // Previous key → DOM-order index, for LIS move computation (Effect-keyed so
    // structural keys compare via Equal).
    let prevIndex = HashMap.empty<unknown, number>();
    prev.order.forEach((key, i) => {
      prevIndex = HashMap.set(prevIndex, key, i);
    });

    // 2. Build the target records (reuse persisted keys, render new keys). The
    //    `sources[j]` is the item's previous DOM index, or -1 when newly created.
    const records: ItemRecord[] = [];
    const sources: number[] = [];
    for (let j = 0; j < items.length; j++) {
      const key = keys[j];
      const existing = HashMap.get(prev.records, key);
      if (Option.isSome(existing)) {
        records.push(existing.value); // KR3: reuse — no re-render, scope untouched.
        sources.push(Option.getOrElse(HashMap.get(prevIndex, key), () => -1));
      } else {
        const record = yield* renderItem(items[j], j, render, regionScope, context);
        records.push(record);
        sources.push(-1);
      }
    }

    // 3. Remove dropped keys: close their scopes (interrupting subscriptions) and
    //    delete their DOM range, markers included (KR4).
    let nextKeySet = HashSet.empty<unknown>();
    for (const key of keys) {
      nextKeySet = HashSet.add(nextKeySet, key);
    }
    for (const key of prev.order) {
      if (!HashSet.has(nextKeySet, key)) {
        const dropped = HashMap.get(prev.records, key);
        if (Option.isSome(dropped)) {
          yield* Scope.close(dropped.value.scope, Exit.void);
          removeItemRange(dropped.value.startMarker, dropped.value.endMarker);
        }
      }
    }

    // 4. Position items with minimal moves (KR5/KR2). Items whose previous indices
    //    form the LIS are already in relative order and are not touched; every
    //    other item (new, or retained-but-out-of-order) is (re)inserted before the
    //    next item's start marker, right-to-left so anchors are already in place.
    const keep = longestIncreasingSubsequence(sources);
    const parent = regionEnd.parentNode;
    if (parent !== null) {
      for (let j = records.length - 1; j >= 0; j--) {
        const record = records[j] as ItemRecord;
        if (sources[j] !== -1 && keep.has(j)) {
          continue; // in the LIS: already correctly positioned.
        }
        const anchor =
          j + 1 < records.length ? (records[j + 1] as ItemRecord).startMarker : regionEnd;
        const range =
          sources[j] === -1
            ? [record.startMarker, ...record.nodes, record.endMarker]
            : collectItemRange(record.startMarker, record.endMarker);
        for (const node of range) {
          parent.insertBefore(node, anchor);
        }
      }
    }

    // 5. New identity map + DOM order.
    let nextRecords = HashMap.empty<unknown, ItemRecord>();
    for (const record of records) {
      nextRecords = HashMap.set(nextRecords, record.key, record);
    }
    return { records: nextRecords, order: keys };
  });
}

/**
 * Renders a single new list item under a fresh per-item scope forked from the
 * region scope (MR2/KR2). The scope persists across emissions until the item is
 * removed; brackets the rendered nodes with per-item markers so the item moves
 * and is removed as a unit.
 */
function renderItem(
  item: unknown,
  index: number,
  render: (item: unknown, index: number) => Renderable,
  regionScope: Scope.Scope,
  context: RenderContext["Type"],
): Effect.Effect<
  ItemRecord,
  StreamSubscriptionError | RenderError | UnsupportedNodeTypeError,
  RenderContext
> {
  return Effect.gen(function* () {
    const key = item;
    const itemScope = yield* Scope.fork(regionScope, ExecutionStrategy.sequential);
    const itemContext = { ...context, scope: itemScope };

    const itemId = yield* nextStreamId();
    const startMarker = document.createComment(listItemStartText(itemId));
    const endMarker = document.createComment(listItemEndText(itemId));

    const result = yield* renderNode(render(item, index)).pipe(
      Effect.provideService(RenderContext, itemContext),
      Effect.provideService(Scope.Scope, itemScope),
    );

    const nodes: Node[] =
      result === null ? [] : Array.isArray(result) ? (result as Node[]) : [result as Node];

    return { key, scope: itemScope, startMarker, endMarker, nodes };
  });
}

/**
 * Collects an item's live DOM range — its start marker through its end marker,
 * inclusive — into an array so the whole unit can be moved with `insertBefore`
 * without the live `nextSibling` chain shifting mid-move.
 */
function collectItemRange(startMarker: Comment, endMarker: Comment): Node[] {
  const nodes: Node[] = [];
  let current: ChildNode | null = startMarker;
  while (current !== null) {
    nodes.push(current);
    if (current === endMarker) {
      break;
    }
    current = current.nextSibling;
  }
  return nodes;
}

/**
 * Removes an item's DOM range — its start marker through its end marker,
 * inclusive — handling any nested reactive content that accrued between them.
 */
function removeItemRange(startMarker: Comment, endMarker: Comment): void {
  let current: ChildNode | null = startMarker;
  while (current !== null) {
    const next: ChildNode | null = current.nextSibling;
    current.remove();
    if (current === endMarker) {
      break;
    }
    current = next;
  }
}

/** Describes a reconciliation key for a duplicate-key {@link RenderError} message. */
function describeKey(key: unknown): string {
  if (typeof key === "string") return JSON.stringify(key);
  if (typeof key === "object" && key !== null) {
    try {
      return JSON.stringify(key);
    } catch {
      return Object.prototype.toString.call(key);
    }
  }
  return String(key);
}

/**
 * Computes a longest strictly-increasing subsequence over `seq` and returns the
 * **set of indices into `seq`** that participate in it (patience-sorting,
 * O(n log n)). Entries equal to `-1` mark newly created items and are excluded —
 * they always need insertion. The returned indices are the retained items that
 * are already in relative DOM order and must not be moved (KR5).
 */
function longestIncreasingSubsequence(seq: readonly number[]): Set<number> {
  const n = seq.length;
  // piles[k] = index into seq of the smallest tail of an increasing run of length k+1.
  const piles: number[] = [];
  const parent: number[] = Array.from({ length: n }, () => -1);

  for (let i = 0; i < n; i++) {
    const x = seq[i] as number;
    if (x === -1) {
      continue; // new item — never part of the retained LIS.
    }
    let lo = 0;
    let hi = piles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((seq[piles[mid] as number] as number) < x) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      parent[i] = piles[lo - 1] as number;
    }
    piles[lo] = i;
  }

  const set = new Set<number>();
  let idx = piles.length > 0 ? (piles[piles.length - 1] as number) : -1;
  while (idx !== -1) {
    set.add(idx);
    idx = parent[idx] as number;
  }
  return set;
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
  app: Renderable,
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
  app: Renderable,
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
 * Hydrates a single Renderable against the DOM, consuming the node(s) starting at
 * `cursor` and returning the next unconsumed sibling.
 */
function hydrateNode(
  node: Renderable,
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
      // Static markup carries its descriptor — hydrate it directly, no execution.
      const descriptor = getElementDescriptor(node);
      if (descriptor !== undefined) {
        return yield* hydrateNode(descriptor, cursor, path);
      }
      // Untagged Effect: probe for synchronous resolution; a genuinely async
      // Effect resolves to a failure exit (AsyncFiberException) and falls through
      // to reactive-region handling below.
      if (Effect.isEffect(node)) {
        // @effect-diagnostics-next-line runEffectInsideEffect:off -- intentional sync probe
        const exit = Effect.runSyncExit(node as Effect.Effect<Renderable, never, never>);
        if (Exit.isSuccess(exit)) {
          return yield* hydrateNode(exit.value, cursor, path);
        }
      }
      return yield* hydrateReactive(toStream<Renderable>(node), cursor, path);
    }

    // Iterables: hydrate children in order, threading the cursor
    if (typeof node === "object" && Symbol.iterator in node && !("type" in node)) {
      let next = cursor;
      let index = 0;
      for (const child of node as Iterable<Renderable>) {
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

      if (type === SUSPENSE_BOUNDARY) {
        // By the time `hydrate` runs, the SSR patch script has already resolved
        // the boundary: the fallback is gone and the children are inline in the
        // DOM. Hydrate the children directly from the current cursor — the
        // Suspense wrapper is transparent to the DOM walk.
        return yield* hydrateChildren(props, cursor, path);
      }

      if (type === FAILURE_BOUNDARY) {
        // Hydration: boundary rendered its children inline (no markers) on the
        // server. Walk children from cursor and set up client boundary normally.
        return yield* hydrateChildren(props, cursor, path);
      }

      if (typeof type === "string") {
        return yield* hydrateElement(type, props, cursor, path);
      }

      if (typeof type === "function") {
        // Components are ephemeral: call once, hydrate the result in place.
        const result = (type as (props: object) => Renderable)(props);
        return yield* hydrateNode(result, cursor, path);
      }

      return yield* Effect.fail(
        new UnsupportedNodeTypeError({
          type,
          message: `Invalid Renderable type during hydration at ${path}: expected string, FRAGMENT, or function, got ${typeof type}`,
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
  stream: Stream.Stream<Renderable>,
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
  value: Renderable,
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
      next = yield* hydrateNode(child as Renderable, next, `${path}[${index}]`);
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
