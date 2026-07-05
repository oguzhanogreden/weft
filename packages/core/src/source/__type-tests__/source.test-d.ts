// oxlint-disable no-unused-vars
/**
 * Type tests for the `Source` channel accessors — `Source.Success`,
 * `Source.Error`, and `Source.Context` over each `Source` kind (Stream / Effect /
 * Subscribable / static value).
 */

import { Effect, Stream } from "effect";
import { Subscribable } from "@weftui/core";
import { Source } from "../source";

// =============================================================================
// Type equality helper
// =============================================================================

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// =============================================================================
// Mock channels and value types
// =============================================================================

interface DataService {
  readonly _: unique symbol;
}
class LoadError {
  readonly _tag = "LoadError";
}

interface Person {
  readonly id: string;
}

type StaticSource = readonly Person[];
type StreamSource = Stream.Stream<readonly Person[], LoadError, DataService>;
type EffectSource = Effect.Effect<readonly Person[], LoadError, DataService>;
type SubSource = Subscribable.Subscribable<readonly Person[], LoadError, DataService>;

// =============================================================================
// Source.Success — emitted value type
// =============================================================================

// A static value is its own success type.
type _S1 = Expect<Equal<Source.Success<StaticSource>, readonly Person[]>>;
// Stream / Effect / Subscribable contribute their value channel.
type _S2 = Expect<Equal<Source.Success<StreamSource>, readonly Person[]>>;
type _S3 = Expect<Equal<Source.Success<EffectSource>, readonly Person[]>>;
type _S4 = Expect<Equal<Source.Success<SubSource>, readonly Person[]>>;

// =============================================================================
// Source.Error — error channel (static ⇒ never)
// =============================================================================

type _E1 = Expect<Equal<Source.Error<StaticSource>, never>>;
type _E2 = Expect<Equal<Source.Error<StreamSource>, LoadError>>;
type _E3 = Expect<Equal<Source.Error<EffectSource>, LoadError>>;
type _E4 = Expect<Equal<Source.Error<SubSource>, LoadError>>;

// =============================================================================
// Source.Context — requirement channel (static ⇒ never)
// =============================================================================

type _C1 = Expect<Equal<Source.Context<StaticSource>, never>>;
type _C2 = Expect<Equal<Source.Context<StreamSource>, DataService>>;
type _C3 = Expect<Equal<Source.Context<EffectSource>, DataService>>;
type _C4 = Expect<Equal<Source.Context<SubSource>, DataService>>;
