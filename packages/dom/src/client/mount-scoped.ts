import { Effect, pipe } from "effect";
import type { Scope } from "effect";
import type {
  AssertNoServerOnly,
  Node as CoreNode,
  Renderable,
  ServerOnlyLeak,
} from "@weftui/core";
import type {
  HydrationMismatchError,
  RenderError,
  StreamSubscriptionError,
  UnsupportedNodeTypeError,
} from "~/data";
import { hydrate, mount, type MountHandle } from "./render";

/**
 * Error union raised by {@link mountScoped} — identical to `mount`'s failure
 * channel.
 */
type MountErrors = UnsupportedNodeTypeError | StreamSubscriptionError | RenderError;

/**
 * Error union raised by {@link hydrateScoped} — `mount`'s errors plus
 * {@link HydrationMismatchError}, matching `hydrate`.
 */
type HydrateErrors = MountErrors | HydrationMismatchError;

/**
 * Scope-aware {@link mount}. Behaves exactly like `mount`, but requires an
 * ambient `Scope.Scope` in the effect's requirement channel and registers
 * `unmount` as a finalizer on it: the mount lives until the ambient scope
 * closes.
 *
 * This makes the mount lifetime composable with Effect's scoped resource
 * management. Provide any scoped layer **outside** a long-lived scoped region so
 * the layer outlives initial render — the mount Effect resolves right after the
 * first render, so a layer released at mount-resolve would be disposed while the
 * app is still running.
 *
 * Like `mount`, `unmount` interrupts subscriptions and disposes the runtime; it
 * does **not** remove DOM nodes from `root`.
 *
 * @param app - Renderable tree to mount
 * @param root - HTMLElement to mount into
 * @returns Effect requiring `Scope.Scope`, yielding a {@link MountHandle}
 *
 * @example
 * ```ts
 * const program = pipe(
 * 	Effect.scoped(
 * 		Effect.gen(function* () {
 * 			yield* mountScoped(App(), root);
 * 			yield* Effect.never; // keep the region (and layer) alive
 * 		}),
 * 	),
 * 	Effect.provide(AppLive), // OUTSIDE the region — lives until it ends
 * );
 * const fiber = Effect.runFork(program); // runFork, not runPromise
 * // later: Effect.runPromise(Fiber.interrupt(fiber));
 * // teardown order: unmount (inner scope close) → AppLive release
 * ```
 *
 * @example Anti-pattern — do NOT do this; the layer is disposed at mount-resolve
 * ```ts
 * // ❌ finalizers run the moment runPromise settles
 * Effect.runPromise(mountScoped(App(), root).pipe(Effect.provide(AppLive), Effect.scoped));
 * ```
 */
export function mountScoped(
  app: Renderable,
  root: HTMLElement,
): Effect.Effect<MountHandle, MountErrors, Scope.Scope> {
  return pipe(
    mount(app, root),
    Effect.tap((handle) => Effect.addFinalizer(() => handle.unmount())),
  );
}

/**
 * Scope-aware {@link hydrate}. Behaves exactly like `hydrate`, but requires an
 * ambient `Scope.Scope` in the effect's requirement channel and registers
 * `unmount` as a finalizer on it: the hydrated mount lives until the ambient
 * scope closes.
 *
 * Preserves `hydrate`'s compile-time client-only guard: a server-only `ServerTag`
 * left in the app's requirement channel degrades the return type to the
 * {@link ServerOnlyLeak} sentinel via {@link AssertNoServerOnly}.
 *
 * @param app - Renderable tree to hydrate (must match the server-rendered tree)
 * @param root - HTMLElement whose children were produced by the server renderer
 * @returns Effect requiring `Scope.Scope`, yielding a {@link MountHandle}, or the
 *   {@link ServerOnlyLeak} sentinel when a server-only requirement leaks
 */
export function hydrateScoped<A extends Renderable>(
  app: A,
  root: HTMLElement,
): [AssertNoServerOnly<CoreNode.Context<A>>] extends [CoreNode.Context<A>]
  ? Effect.Effect<MountHandle, HydrateErrors, Scope.Scope>
  : ServerOnlyLeak;
export function hydrateScoped(
  app: Renderable,
  root: HTMLElement,
): Effect.Effect<MountHandle, HydrateErrors, Scope.Scope> {
  return pipe(
    hydrate(app, root),
    Effect.tap((handle) => Effect.addFinalizer(() => handle.unmount())),
  );
}
