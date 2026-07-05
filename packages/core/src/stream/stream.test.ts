import * as assert from "node:assert/strict";
import { Effect, Stream } from "effect";
import { describe, it } from "vite-plus/test";
import { isStream, toStream } from "./stream";

const collect = <A>(stream: Stream.Stream<A>) => Effect.runPromise(Stream.runCollect(stream));

describe("toStream", () => {
  it("AC-1: normalizes a static value to a single-element stream", async () => {
    assert.deepEqual(await collect(toStream(42)), [42]);
    assert.deepEqual(await collect(toStream("hello")), ["hello"]);
  });

  it("AC-2: normalizes an Effect to a one-shot stream", async () => {
    assert.deepEqual(await collect(toStream(Effect.succeed(7))), [7]);
  });

  it("AC-3: returns an existing stream unchanged", async () => {
    const source = Stream.make(1, 2, 3);
    const result = toStream(source);
    assert.equal(result, source);
    assert.deepEqual(await collect(result), [1, 2, 3]);
  });
});

describe("isStream", () => {
  it("AC-4: distinguishes streams from values, effects, and nullish", () => {
    assert.equal(isStream(Stream.make(1)), true);
    assert.equal(isStream(42), false);
    assert.equal(isStream("hello"), false);
    assert.equal(isStream(Effect.succeed(1)), false);
    assert.equal(isStream(null), false);
    assert.equal(isStream(undefined), false);
    assert.equal(isStream({}), false);
  });
});
