import * as assert from "node:assert/strict";
import { Boundary, ServerTag, h } from "@effect-ui/core";
import { Data, Effect, Exit, Layer, Schema, Stream } from "effect";
import { describe, it } from "vite-plus/test";
import { renderToStream } from "./render-to-stream";
import { renderToString, renderToStringHydratable } from "./render-to-string";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ProductShape {
  readonly name: string;
  readonly price: number;
}

/** A server-only data source, discharged at the boundary via `provide`. */
class Database extends ServerTag("Database")<
  Database,
  { readonly getProduct: () => Effect.Effect<ProductShape> }
>() {}

const DatabaseLive = Layer.succeed(Database, {
  getProduct: () => Effect.succeed({ name: "Widget", price: 9 }),
});

const Product = Schema.Struct({ name: Schema.String, price: Schema.Number });

/** Reads the product from the server-only `Database`, renders its name. */
const ProductBoundary = () =>
  Boundary.server(
    {
      load: () => Effect.flatMap(Database, (db) => db.getProduct()),
      provide: DatabaseLive,
      schema: Product,
    },
    (data) => h.div({ class: "product" }, data.name),
  );

const SCRIPT_RE = /<script type="application\/json">(.*?)<\/script>/;
const SCRIPT_RE_G = /<script type="application\/json">(.*?)<\/script>/g;

const decodeScript = (json: string) =>
  Effect.runPromise(Schema.decodeUnknown(Product)(JSON.parse(json)));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Boundary.server — hydratable SSR (AC-10)", () => {
  it("emits an inline JSON payload that decodes back to the loaded data", async () => {
    const html = await Effect.runPromise(renderToStringHydratable(ProductBoundary()));

    const match = SCRIPT_RE.exec(html);
    assert.ok(match !== null, "expected an application/json payload script");
    const decoded = await decodeScript(match[1] as string);
    assert.deepEqual(decoded, { name: "Widget", price: 9 });
  });

  it("renders render(data) HTML in place", async () => {
    const html = await Effect.runPromise(renderToStringHydratable(ProductBoundary()));
    assert.ok(html.includes('<div class="product">Widget</div>'));
  });

  it("emits the payload before the render(data) HTML (positional, AC-14)", async () => {
    const html = await Effect.runPromise(renderToStringHydratable(ProductBoundary()));
    assert.ok(html.indexOf("<script") < html.indexOf("<div"));
  });
});

describe("Boundary.server — plain SSR (AC-11/AC-12)", () => {
  it("renderToString renders render(data) HTML with no payload script", async () => {
    const html = await Effect.runPromise(renderToString(ProductBoundary()));
    assert.ok(html.includes('<div class="product">Widget</div>'));
    assert.ok(!html.includes("<script"));
  });

  it("renderToStream (plain) renders render(data) HTML with no payload script", async () => {
    const html = await Effect.runPromise(Stream.mkString(renderToStream(ProductBoundary())));
    assert.ok(html.includes('<div class="product">Widget</div>'));
    assert.ok(!html.includes("<script"));
  });
});

describe("Boundary.server — nesting", () => {
  it("emits nested payloads positionally, each decodable", async () => {
    const Nested = () =>
      Boundary.server(
        {
          load: () => Effect.succeed({ name: "Outer", price: 1 }),
          provide: Layer.empty,
          schema: Product,
        },
        (outer) =>
          h.div({}, [
            outer.name,
            Boundary.server(
              {
                load: () => Effect.succeed({ name: "Inner", price: 2 }),
                provide: Layer.empty,
                schema: Product,
              },
              (inner) => h.span({}, inner.name),
            ),
          ]),
      );

    const html = await Effect.runPromise(renderToStringHydratable(Nested()));
    const scripts = [...html.matchAll(SCRIPT_RE_G)];
    assert.equal(scripts.length, 2);

    const outer = await decodeScript(scripts[0]![1] as string);
    const inner = await decodeScript(scripts[1]![1] as string);
    assert.equal(outer.name, "Outer");
    assert.equal(inner.name, "Inner");

    // Outer payload precedes the <div>; inner payload sits inside the <div>,
    // before the <span> it hydrates.
    assert.ok(html.indexOf(scripts[0]![0]) < html.indexOf("<div>"));
    const innerIdx = html.indexOf(scripts[1]![0]);
    assert.ok(innerIdx > html.indexOf("<div>"));
    assert.ok(innerIdx < html.indexOf("<span>"));
  });
});

describe("Boundary.server — load failure (server-side, v1)", () => {
  // v1 contract: a `load` failure is handled server-side only — it propagates as
  // a stream failure to the nearest enclosing failure `Boundary`, so the no-JS
  // page shows that fallback. (Typed-failure *replay* on the client is deferred.)
  class LoadError extends Data.TaggedError("LoadError")<{ readonly reason: string }> {}

  const failingBoundary = () =>
    Boundary.server(
      {
        load: () => Effect.fail(new LoadError({ reason: "db down" })),
        provide: Layer.empty,
        schema: Product,
      },
      (data) => h.div({ class: "product" }, data.name),
    );

  it("propagates a load failure to the nearest enclosing failure Boundary (plain SSR)", async () => {
    const node = Boundary.catchAll(
      { fallback: (e: LoadError) => h.div({ class: "fallback" }, e.reason) },
      [failingBoundary()],
    );

    const html = await Effect.runPromise(renderToString(node));
    assert.ok(html.includes('<div class="fallback">db down</div>'));
    assert.ok(!html.includes('class="product"'));
  });

  it("emits no payload script when load fails under a failure boundary (hydratable)", async () => {
    const node = Boundary.catchAll({ fallback: () => h.div({ class: "fallback" }, "oops") }, [
      failingBoundary(),
    ]);

    const html = await Effect.runPromise(renderToStringHydratable(node));
    assert.ok(html.includes('<div class="fallback">oops</div>'));
    assert.ok(!html.includes("<script"));
  });
});

describe("Boundary.server — encode failure (server-side)", () => {
  it("fails the hydratable render when loaded data does not satisfy the schema", async () => {
    // `load` yields a value whose `name` is a number, violating `Product`; the
    // hydratable pass `Schema.encode`s `data`, so the bad value surfaces as a
    // stream failure rather than emitting a corrupt payload.
    const node = Boundary.server(
      {
        load: () => Effect.succeed({ name: 123, price: 9 } as unknown as ProductShape),
        provide: Layer.empty,
        schema: Product,
      },
      (data) => h.div({ class: "product" }, String(data.name)),
    );

    const exit = await Effect.runPromiseExit(renderToStringHydratable(node));
    assert.ok(Exit.isFailure(exit));
  });
});

describe("Boundary.server — payload escaping (XSS-safe)", () => {
  it("escapes characters unsafe in an inline <script> and still round-trips", async () => {
    const Evil = Schema.Struct({ html: Schema.String });
    const node = Boundary.server(
      {
        load: () => Effect.succeed({ html: "</script><script>alert(1)</script>" }),
        provide: Layer.empty,
        schema: Evil,
      },
      () => h.div({}, "ok"),
    );

    const html = await Effect.runPromise(renderToStringHydratable(node));

    // The raw closing tag must not appear inside the payload — `<` is escaped.
    assert.ok(!html.includes("</script><script>alert"));
    assert.ok(html.includes("\\u003c/script\\u003e\\u003cscript\\u003e"));

    // It still parses as JSON and decodes to the original string.
    const match = SCRIPT_RE.exec(html);
    assert.ok(match !== null);
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(Evil)(JSON.parse(match[1] as string)),
    );
    assert.equal(decoded.html, "</script><script>alert(1)</script>");
  });
});
