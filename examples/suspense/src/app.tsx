/**
 * Isomorphic `<App/>` demonstrating `<Suspense>` boundaries.
 *
 * Rendered to streaming hydratable HTML on the server, then hydrated on the
 * client. The `<Dashboard>` shows three sibling async cards under one shared
 * fallback — all three must settle before the fallback is replaced. The
 * `<NestedExample>` shows an inner boundary resolving independently of the
 * outer one.
 *
 * On the server (`renderToStreamHydratable`):
 *   - Fallback + comment markers emitted inline immediately
 *   - `<template>` + `<script>` patch appended as each boundary resolves
 *   - Patch script swaps fallback → resolved content before hydrate() runs
 *
 * On the client (`mount`):
 *   - Fallback shown while all sibling children are pending
 *   - Single atomic DOM swap once every child has emitted its first value
 */

import { Effect, pipe } from "effect";
import { Suspense } from "@effect-ui/core";

// ============================================================================
// Simulated data layer
// ============================================================================

interface CardData {
  readonly title: string;
  readonly body: string;
}

/** Simulates a network fetch with a configurable delay. */
function fetchCard(id: number): Effect.Effect<CardData> {
  return pipe(
    Effect.succeed<CardData>({
      title: `Card ${id}`,
      body: `Loaded after ${id * 300}ms`,
    }),
    Effect.delay(`${id * 300} millis`),
  );
}

// ============================================================================
// Card component
// ============================================================================

/**
 * Async card — returns an `Effect<JSXNode>` so it triggers Suspense.
 * The delay is proportional to `id` so the three cards resolve at different
 * times (but the shared fallback waits for all of them).
 */
function Card({ id }: { id: number }): Effect.Effect<JSX.Element> {
  return fetchCard(id).pipe(
    Effect.map((data) => (
      <div class="card">
        <h3 class="card-title">{data.title}</h3>
        <p class="card-body">{data.body}</p>
      </div>
    )),
  );
}

// ============================================================================
// Dashboard: three sibling cards under one Suspense
// ============================================================================

/**
 * Three `<Card>` siblings share a single `<Suspense>` boundary. The fallback
 * persists until **all three** have settled, then all are revealed together.
 */
function Dashboard(): JSX.Element {
  return (
    <section class="section">
      <h2 class="section-title">Shared Fallback (3 sibling cards)</h2>
      <p class="section-desc">
        One fallback covers all three cards. The resolved layout appears only once every card has
        loaded. Cards resolve at 300 ms, 600 ms, and 900 ms.
      </p>
      <Suspense
        fallback={
          <div class="fallback">
            <span class="spinner" aria-hidden="true">
              ⏳
            </span>{" "}
            Loading all cards…
          </div>
        }
      >
        <div class="card-grid">
          <Card id={1} />
          <Card id={2} />
          <Card id={3} />
        </div>
      </Suspense>
    </section>
  );
}

// ============================================================================
// NestedExample: inner boundary resolves before outer
// ============================================================================

/**
 * The inner `<Suspense>` resolves at 200 ms; the outer resolves at 800 ms.
 * Each boundary is independent — the inner swap happens first without
 * disturbing the outer fallback.
 */
function SlowOuter(): Effect.Effect<JSX.Element> {
  return pipe(
    Effect.succeed(<p class="outer-content">Outer async content loaded.</p>),
    Effect.delay("800 millis"),
  );
}

function SlowInner(): Effect.Effect<JSX.Element> {
  return pipe(
    Effect.succeed(<p class="inner-content">Inner resolved first (200 ms).</p>),
    Effect.delay("200 millis"),
  );
}

function NestedExample(): JSX.Element {
  return (
    <section class="section">
      <h2 class="section-title">Nested Boundaries</h2>
      <p class="section-desc">
        Inner boundary resolves at 200 ms; outer at 800 ms. Each swap is independent.
      </p>
      <Suspense
        fallback={
          <div class="fallback">
            <span class="spinner" aria-hidden="true">
              ⏳
            </span>{" "}
            Outer loading…
          </div>
        }
      >
        <div class="nested-outer">
          <SlowOuter />
          <Suspense
            fallback={
              <div class="fallback fallback--inner">
                <span class="spinner" aria-hidden="true">
                  ⏳
                </span>{" "}
                Inner loading…
              </div>
            }
          >
            <SlowInner />
          </Suspense>
        </div>
      </Suspense>
    </section>
  );
}

// ============================================================================
// Root component
// ============================================================================

export function App(): JSX.Element {
  return (
    <div class="app">
      <header class="header">
        <h1>effect-ui — Suspense</h1>
        <p class="subtitle">
          Streaming SSR with fallback → patch swap, and client-side boundary coordination.
        </p>
      </header>
      <main class="main">
        <Dashboard />
        <NestedExample />
      </main>
      <footer class="footer">
        <span class="status" id="status">
          [SSR — not yet interactive]
        </span>
      </footer>
    </div>
  );
}
