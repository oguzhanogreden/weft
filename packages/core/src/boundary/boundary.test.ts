import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { Cause, Data, Option } from "effect";
import { BOUNDARY, Boundary, type BoundaryProps } from "./index";
import type { Node } from "~/combinator/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

class FooError extends Data.TaggedError("Foo")<{ msg: string }> {}
class BarError extends Data.TaggedError("Bar")<{ code: number }> {}

const fallbackNode = { type: "span", props: { children: ["fallback"] } } as unknown as Node<never>;

function extractDescriptor(node: unknown): { type: unknown; props: BoundaryProps } {
  return node as { type: unknown; props: BoundaryProps };
}

// ── AC1: Descriptor shape ─────────────────────────────────────────────────────

describe("AC1: descriptor shape", () => {
  it("catchAll returns { type: BOUNDARY, props: { match, children } }", () => {
    const node = Boundary.catchAll({ fallback: () => fallbackNode }, []);
    const { type, props } = extractDescriptor(node);
    assert.equal(type, BOUNDARY);
    assert.equal(typeof props.match, "function");
    assert.ok(Array.isArray(props.children));
  });

  it("catchAllCause returns BOUNDARY descriptor", () => {
    const node = Boundary.catchAllCause({ fallback: () => fallbackNode }, []);
    const { type } = extractDescriptor(node);
    assert.equal(type, BOUNDARY);
  });

  it("catchTag returns BOUNDARY descriptor", () => {
    const child = { type: "div", props: {} } as unknown as Node<FooError>;
    const node = Boundary.catchTag({ tag: "Foo", fallback: () => fallbackNode }, [child]);
    const { type } = extractDescriptor(node);
    assert.equal(type, BOUNDARY);
  });

  it("catchTags returns BOUNDARY descriptor", () => {
    const child = { type: "div", props: {} } as unknown as Node<FooError>;
    const node = Boundary.catchTags({ Foo: () => fallbackNode }, [child]);
    const { type } = extractDescriptor(node);
    assert.equal(type, BOUNDARY);
  });

  it("catchSome returns BOUNDARY descriptor", () => {
    const node = Boundary.catchSome({ fallback: () => Option.none() }, []);
    const { type } = extractDescriptor(node);
    assert.equal(type, BOUNDARY);
  });

  it("catchIf returns BOUNDARY descriptor", () => {
    const node = Boundary.catchIf({ predicate: () => true, fallback: () => fallbackNode }, []);
    const { type } = extractDescriptor(node);
    assert.equal(type, BOUNDARY);
  });

  it("children are preserved in props", () => {
    const child = { type: "div", props: {} } as unknown as Node<never>;
    const node = Boundary.catchAll({ fallback: () => fallbackNode }, [child]);
    const { props } = extractDescriptor(node);
    assert.equal(props.children.length, 1);
    assert.equal(props.children[0], child);
  });
});

// ── AC4: catchAll match ───────────────────────────────────────────────────────

describe("AC4: catchAll match", () => {
  it("returns fallback node for typed failure", () => {
    const expected = { type: "span", props: {} } as unknown as Node<never>;
    const node = Boundary.catchAll({ fallback: () => expected }, []);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.fail(new FooError({ msg: "oops" })));
    assert.equal(result, expected);
  });

  it("passes the failure value to the fallback", () => {
    let received: unknown;
    const err = new FooError({ msg: "test" });
    const node = Boundary.catchAll(
      {
        fallback: (e) => {
          received = e;
          return fallbackNode;
        },
      },
      [],
    );
    const { props } = extractDescriptor(node);
    props.match(Cause.fail(err));
    assert.equal(received, err);
  });

  it("returns null for defect (Cause.die)", () => {
    const node = Boundary.catchAll({ fallback: () => fallbackNode }, []);
    const { props } = extractDescriptor(node);
    assert.equal(props.match(Cause.die("boom")), null);
  });

  it("returns null for interrupt", () => {
    const node = Boundary.catchAll({ fallback: () => fallbackNode }, []);
    const { props } = extractDescriptor(node);
    // Cause.empty has no failure — represents interrupt-like empty cause
    assert.equal(props.match(Cause.empty), null);
  });
});

// ── AC7: catchAllCause match ──────────────────────────────────────────────────

describe("AC7: catchAllCause match", () => {
  it("returns fallback for typed failure", () => {
    const node = Boundary.catchAllCause({ fallback: () => fallbackNode }, []);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.fail(new FooError({ msg: "e" })));
    assert.equal(result, fallbackNode);
  });

  it("returns fallback for defect (Cause.die)", () => {
    const node = Boundary.catchAllCause({ fallback: () => fallbackNode }, []);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.die("boom"));
    assert.equal(result, fallbackNode);
  });

  it("passes the full Cause to the fallback", () => {
    let received: unknown;
    const cause = Cause.die("boom");
    const node = Boundary.catchAllCause(
      {
        fallback: (c) => {
          received = c;
          return fallbackNode;
        },
      },
      [],
    );
    const { props } = extractDescriptor(node);
    props.match(cause);
    assert.equal(received, cause);
  });
});

// ── AC9: catchTag match ───────────────────────────────────────────────────────

describe("AC9: catchTag match", () => {
  const fooChild = { type: "div", props: {} } as unknown as Node<FooError>;

  it("returns fallback when tag matches", () => {
    const node = Boundary.catchTag({ tag: "Foo", fallback: () => fallbackNode }, [fooChild]);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.fail(new FooError({ msg: "e" })));
    assert.equal(result, fallbackNode);
  });

  it("returns null when tag does not match", () => {
    const node = Boundary.catchTag({ tag: "Foo", fallback: () => fallbackNode }, [fooChild]);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.fail(new BarError({ code: 42 })));
    assert.equal(result, null);
  });

  it("returns null for defect", () => {
    const node = Boundary.catchTag({ tag: "Foo", fallback: () => fallbackNode }, [fooChild]);
    const { props } = extractDescriptor(node);
    assert.equal(props.match(Cause.die("boom")), null);
  });
});

// ── AC14: catchTags match ─────────────────────────────────────────────────────

describe("AC14: catchTags match", () => {
  const fooFallback = { type: "span", props: { id: "foo" } } as unknown as Node<never>;
  const barFallback = { type: "span", props: { id: "bar" } } as unknown as Node<never>;
  const fooChild = { type: "div", props: {} } as unknown as Node<FooError>;
  const barChild = { type: "div", props: {} } as unknown as Node<BarError>;

  it("routes to Foo handler for FooError", () => {
    const node = Boundary.catchTags({ Foo: () => fooFallback, Bar: () => barFallback }, [
      fooChild,
      barChild,
    ]);
    const { props } = extractDescriptor(node);
    assert.equal(props.match(Cause.fail(new FooError({ msg: "e" }))), fooFallback);
  });

  it("routes to Bar handler for BarError", () => {
    const node = Boundary.catchTags({ Foo: () => fooFallback, Bar: () => barFallback }, [
      fooChild,
      barChild,
    ]);
    const { props } = extractDescriptor(node);
    assert.equal(props.match(Cause.fail(new BarError({ code: 0 }))), barFallback);
  });

  it("returns null for unregistered tag", () => {
    const node = Boundary.catchTags({ Foo: () => fooFallback }, [fooChild]);
    const { props } = extractDescriptor(node);
    assert.equal(props.match(Cause.fail(new BarError({ code: 0 }))), null);
  });

  it("returns null for defect", () => {
    const node = Boundary.catchTags({ Foo: () => fooFallback }, [fooChild]);
    const { props } = extractDescriptor(node);
    assert.equal(props.match(Cause.die("boom")), null);
  });
});

// ── AC17: catchSome match ─────────────────────────────────────────────────────

describe("AC17: catchSome match", () => {
  it("returns node when fallback returns Option.some", () => {
    const node = Boundary.catchSome({ fallback: () => Option.some(fallbackNode) }, []);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.fail(new FooError({ msg: "e" })));
    assert.equal(result, fallbackNode);
  });

  it("returns null when fallback returns Option.none", () => {
    const node = Boundary.catchSome({ fallback: () => Option.none() }, []);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.fail(new FooError({ msg: "e" })));
    assert.equal(result, null);
  });

  it("returns null for defect", () => {
    const node = Boundary.catchSome({ fallback: () => Option.some(fallbackNode) }, []);
    const { props } = extractDescriptor(node);
    assert.equal(props.match(Cause.die("boom")), null);
  });
});

// ── AC20: catchIf match ───────────────────────────────────────────────────────

describe("AC20: catchIf match", () => {
  it("returns fallback when predicate is true", () => {
    const node = Boundary.catchIf({ predicate: () => true, fallback: () => fallbackNode }, []);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.fail(new FooError({ msg: "e" })));
    assert.equal(result, fallbackNode);
  });

  it("returns null when predicate is false", () => {
    const node = Boundary.catchIf({ predicate: () => false, fallback: () => fallbackNode }, []);
    const { props } = extractDescriptor(node);
    const result = props.match(Cause.fail(new FooError({ msg: "e" })));
    assert.equal(result, null);
  });

  it("returns null for defect", () => {
    const node = Boundary.catchIf({ predicate: () => true, fallback: () => fallbackNode }, []);
    const { props } = extractDescriptor(node);
    assert.equal(props.match(Cause.die("boom")), null);
  });

  it("passes the error to the predicate", () => {
    let received: unknown;
    const err = new FooError({ msg: "pred-test" });
    const node = Boundary.catchIf(
      {
        predicate: (e) => {
          received = e;
          return true;
        },
        fallback: () => fallbackNode,
      },
      [],
    );
    const { props } = extractDescriptor(node);
    props.match(Cause.fail(err));
    assert.equal(received, err);
  });
});

// ── AC23/24: Call shape ───────────────────────────────────────────────────────

describe("AC23/24: call shape", () => {
  it("all variants accept (props, children)", () => {
    const fooChild = { type: "div", props: {} } as unknown as Node<FooError>;
    assert.doesNotThrow(() => Boundary.catchAll({ fallback: () => fallbackNode }, [fooChild]));
    assert.doesNotThrow(() => Boundary.catchAllCause({ fallback: () => fallbackNode }, [fooChild]));
    assert.doesNotThrow(() =>
      Boundary.catchTag({ tag: "Foo", fallback: () => fallbackNode }, [fooChild]),
    );
    assert.doesNotThrow(() =>
      Boundary.catchSome({ fallback: () => Option.some(fallbackNode) }, [fooChild]),
    );
    assert.doesNotThrow(() =>
      Boundary.catchIf({ predicate: () => true, fallback: () => fallbackNode }, [fooChild]),
    );
  });

  it("catchTags accepts (handlers, children)", () => {
    const fooChild = { type: "div", props: {} } as unknown as Node<FooError>;
    assert.doesNotThrow(() => Boundary.catchTags({ Foo: () => fallbackNode }, [fooChild]));
  });
});
