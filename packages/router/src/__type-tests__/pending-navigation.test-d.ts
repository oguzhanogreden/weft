/**
 * Type tests for pending navigation (spec: `pending-navigation.specs.md`).
 *
 * The `Router` service `Type` must carry a reactive `navigating: Subscribable<NavState>`,
 * `NavState` is a discriminated `Idle | Navigating{to}` union, and
 * `Router.navigatingStream` yields that Subscribable under the `Router` requirement.
 */

import type { Effect } from "effect";
import type { Subscribable } from "@weftui/core";
import type { NavState } from "~/router-service";
import { Router } from "~/router-service";

// ── NavState is a discriminated union of Idle | Navigating{to} ─────────────────

const _idle: NavState = { _tag: "Idle" };
const _navigating: NavState = { _tag: "Navigating", to: "/x" };

// @ts-expect-error — `Navigating` requires a `to` string.
const _missingTo: NavState = { _tag: "Navigating" };

// @ts-expect-error — an unknown tag is not a `NavState`.
const _badTag: NavState = { _tag: "Loading" };

// ── The service Type carries `navigating: Subscribable<NavState>` ──────────────

type Navigating = Router["Service"]["navigating"];
const _isSubscribable: Navigating extends Subscribable.Subscribable<NavState> ? true : false = true;
const _carriesNavState: Subscribable.Subscribable<NavState> extends Navigating ? true : false =
  true;

// ── `Router.navigatingStream` yields the Subscribable under `Router` ───────────

const _stream: Effect.Effect<
  Subscribable.Subscribable<NavState>,
  never,
  Router
> = Router.navigatingStream;
