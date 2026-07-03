/**
 * Type tests for resolve-before-commit navigation (spec:
 * `resolve-before-commit.specs.md`).
 *
 * The feature adds **no public API**: the resolved-commit stash and the staged
 * match view are internal seams (`resolved-commit.ts`, not re-exported from
 * `src/index.ts`). These tests pin that internality — the stash key must not be
 * readable off the public `Router` service `Type` — and the shape of the
 * internal contract the outlet and the client `navigate` share.
 */

import type { Renderable } from "@weftui/core";
import type { Effect, Exit } from "effect";
import type { RouteMatch } from "~/matcher";
import type { ResolvedCommitEntry, ResolvedCommitSlot } from "~/resolved-commit";
import { ResolvedCommit, preRunLeaf, stageMatch, takeResolvedCommit } from "~/resolved-commit";
import type { Router } from "~/router-service";

declare const router: Router["Type"];
declare const target: RouteMatch;

// ── The stash does not leak into the public service type ───────────────────────

// @ts-expect-error — `Router["Type"]` carries no ResolvedCommit member; only an
// instance explicitly widened to `ResolvedCommitSlot` may be indexed by the brand.
const _leak = router[ResolvedCommit];

// A widened instance is indexable, and the entry is `{ url, exit } | undefined`.
declare const slot: Router["Type"] & ResolvedCommitSlot;
const _entry: ResolvedCommitEntry | undefined = slot[ResolvedCommit];

// ── Entry shape: committed url + the pre-run's Exit over a Renderable ──────────

declare const entry: ResolvedCommitEntry;
const _url: string = entry.url;
const _exit: Exit.Exit<Renderable, unknown> = entry.exit;

// @ts-expect-error — entries are immutable.
entry.url = "/elsewhere";

// ── Internal function contracts ─────────────────────────────────────────────────

// `takeResolvedCommit` consumes by exact committed url and may miss.
const _taken: ResolvedCommitEntry | undefined = takeResolvedCommit(router, "/docs/a/b");

// `stageMatch` returns a full `Router` view — a drop-in for the live service.
const _staged: Router["Type"] = stageMatch(router, target);

// `preRunLeaf` never fails and needs no context beyond the caller's runtime:
// failures are folded into the returned `Exit` (AC-R7).
const _preRun: Effect.Effect<Exit.Exit<Renderable, unknown>> = preRunLeaf(router, target);
