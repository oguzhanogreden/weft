// oxlint-disable no-unused-vars

/**
 * Type tests for JSX.Requirements augmentation feature.
 *
 * These tests verify compile-time behavior only - they don't run at runtime.
 * Use `@ts-expect-error` to assert that certain code should NOT compile.
 */

import type { Context, Effect, Stream } from "effect";
import type { JSXNode } from "~/types";

// =============================================================================
// Test Setup: Define mock services
// =============================================================================

interface ServiceA {
  readonly a: string;
}
interface ServiceB {
  readonly b: number;
}
interface ServiceC {
  readonly c: boolean;
}

declare const TagA: Context.Tag<ServiceA, ServiceA>;
declare const TagB: Context.Tag<ServiceB, ServiceB>;
declare const TagC: Context.Tag<ServiceC, ServiceC>;

// =============================================================================
// Test: Default behavior (no augmentation)
// JSXRequirements defaults to `any`, accepting all streams/effects
// =============================================================================

// Without augmentation, all requirement types should be accepted
declare const streamWithServiceA: Stream.Stream<string, never, ServiceA>;
declare const streamWithServiceB: Stream.Stream<string, never, ServiceB>;
declare const streamWithBothServices: Stream.Stream<string, never, ServiceA | ServiceB>;
declare const streamWithNoRequirements: Stream.Stream<string, never, never>;

// All should be assignable to JSXChild (default permissive mode)
const _defaultA: JSXNode = streamWithServiceA;
const _defaultB: JSXNode = streamWithServiceB;
const _defaultBoth: JSXNode = streamWithBothServices;
const _defaultNone: JSXNode = streamWithNoRequirements;

// Effects should also work
declare const effectWithServiceA: Effect.Effect<string, never, ServiceA>;
const _effectA: JSXNode = effectWithServiceA;

// =============================================================================
// Test: Augmented behavior
// When JSX.Requirements is augmented, only registered services are accepted
// =============================================================================

// Augment JSX.Requirements with ServiceA and ServiceB
declare global {
  namespace JSX {
    interface Requirements {
      _: ServiceA | ServiceB;
    }
  }
}

// Streams with registered services should be accepted
const _augmentedA: JSXNode = streamWithServiceA;
const _augmentedB: JSXNode = streamWithServiceB;
const _augmentedBoth: JSXNode = streamWithBothServices;
const _augmentedNone: JSXNode = streamWithNoRequirements;

// Stream with unregistered service should fail
declare const streamWithServiceC: Stream.Stream<string, never, ServiceC>;
// @ts-expect-error - ServiceC is not registered in JSX.Requirements
const _unregistered: JSXNode = streamWithServiceC;

// Stream with mix of registered and unregistered should fail
declare const streamWithAandC: Stream.Stream<string, never, ServiceA | ServiceC>;
// @ts-expect-error - ServiceC is not registered in JSX.Requirements
const _mixedUnregistered: JSXNode = streamWithAandC;

// =============================================================================
// Test: Effect with requirements
// =============================================================================

declare const effectWithServiceC: Effect.Effect<string, never, ServiceC>;
// @ts-expect-error - ServiceC is not registered in JSX.Requirements
const _effectUnregistered: JSXNode = effectWithServiceC;

// =============================================================================
// Test: Nested JSXChild (recursive type)
// =============================================================================

declare const nestedStream: Stream.Stream<Stream.Stream<string, never, ServiceA>, never, ServiceB>;
const _nested: JSXNode = nestedStream;

// =============================================================================
// Test: Component return types
// =============================================================================

type Component<R> = () => Stream.Stream<string, never, R>;

declare const componentA: Component<ServiceA>;
declare const componentB: Component<ServiceB>;
declare const componentC: Component<ServiceC>;

// Components returning registered services should work
const _compResultA: JSXNode = componentA();
const _compResultB: JSXNode = componentB();

// Component returning unregistered service should fail
// @ts-expect-error - ServiceC is not registered in JSX.Requirements
const _compResultC: JSXNode = componentC();
