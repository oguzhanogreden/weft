/**
 * Internal seams for resolve-before-commit navigation — the resolved-commit
 * stash and the staged match view. See `resolve-before-commit.specs.md`.
 *
 * **Not public API.** This module is deliberately not re-exported from
 * `src/index.ts` (mirroring the internality of `PreloadSlot` in `route-tree.ts`):
 * it is consumed by the client `navigate` (`client/router-live.ts`), which
 * pre-runs the matched leaf's component effect and stashes its `Exit`, and by
 * the outlet's leaf render (`outlet.ts`), which consumes the stash to swap in
 * the already-resolved node synchronously.
 *
 * The server router and the hydrate path never touch this module's state: the
 * stash is only ever written by a client navigation, so `renderLevel` falls
 * through to the ordinary slot invocation everywhere else (AC-R13).
 */

import type { Renderable } from "@weftui/core";
import type { Effect, Exit } from "effect";
import type { RouteMatch } from "./matcher";
import type { Router } from "./router-service";

/**
 * Brand key under which the client `Router` service instance carries its
 * mutable resolved-commit stash. Internal to `@weftui/router`; declared
 * `unique symbol` so it is usable as a computed interface key.
 */
export const ResolvedCommit: unique symbol = Symbol.for("@weftui/router/resolved-commit");

/**
 * One pre-run outcome, stashed by `navigate` immediately before it commits the
 * URL ref and consumed exactly once by the outlet's next leaf emission.
 */
export interface ResolvedCommitEntry {
  /** The exact committed `path + search` this outcome belongs to. */
  readonly url: string;
  /**
   * The pre-run's outcome. `Success` carries the leaf's fully-resolved node
   * (the atomic-swap path, AC-R2); `Failure` carries the cause the outlet
   * replays via `Effect.failCause` so the error surfaces through the normal
   * render error path without re-running the component (AC-R7).
   */
  readonly exit: Exit.Exit<Renderable, unknown>;
}

/**
 * A `Router` service instance that may carry the resolved-commit stash. Only
 * the client (`RouterLive`) router is ever widened to this shape; the key is
 * optional so the server router type-checks unchanged (AC-R13).
 */
export interface ResolvedCommitSlot {
  [ResolvedCommit]?: ResolvedCommitEntry | undefined;
}

/**
 * Writes the stash on the (client) router instance: called by `navigate` /
 * popstate with the pre-run's `Exit`, immediately before the URL ref is set,
 * so the outlet emission triggered by that commit finds it (AC-R1/AC-R2).
 * Overwrites any stale entry — latest-wins already guarantees only the newest
 * navigation reaches the commit step (AC-R6).
 */
export declare function setResolvedCommit(router: Router["Type"], entry: ResolvedCommitEntry): void;

/**
 * Consumes the stash: returns the entry when its `url` equals the emission's
 * `match.url` and **clears the slot** (consume-exactly-once, AC-R2), else
 * `undefined` — a URL mismatch (stale entry) or an absent slot (server render,
 * hydration, non-navigation re-emission) falls through to the ordinary slot
 * invocation in `renderLevel`.
 */
export declare function takeResolvedCommit(
  router: Router["Type"],
  url: string,
): ResolvedCommitEntry | undefined;

/**
 * The staged `Router` view the pre-run executes under (AC-R4): identical to
 * `router` except `currentMatch.get` resolves to the **target** match — the
 * URL ref has not moved yet, and one-shot reads (`Router.params`,
 * `Router.query`, `currentMatch.get`) inside the pre-running component body
 * must decode the destination, not the page being left. `currentMatch.changes`
 * (and `navigate` / `httpApiClient` / `navigating`) delegate to the live
 * service, so reactive subscriptions — which occur at render/mount time,
 * post-commit — observe the committed match onward.
 */
export declare function stageMatch(router: Router["Type"], target: RouteMatch): Router["Type"];

/**
 * Pre-runs a matched leaf's component effect: invokes the slot with the
 * target match's handler-arg props (`{ path, query }` — exactly what
 * `renderLevel` passes), under the {@link stageMatch | staged view}, and
 * captures the outcome as an `Exit` (AC-R1/AC-R7). The returned effect never
 * fails — failures are folded into the `Exit` for stash-and-replay — but it
 * is **interruptible**: a superseding navigation interrupts the whole pre-run
 * fiber (AC-R6). Requires the caller's runtime context (the `RouterLive`
 * layer's — `Router`, `AppRpcClientTag`, app services), which is what makes
 * the pre-run possible at all (Feasibility §1).
 */
export declare function preRunLeaf(
  router: Router["Type"],
  target: RouteMatch,
): Effect.Effect<Exit.Exit<Renderable, unknown>>;
