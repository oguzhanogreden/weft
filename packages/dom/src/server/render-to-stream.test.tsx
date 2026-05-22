import * as assert from "node:assert/strict";
import type { JSXNode } from "@effect-ui/core/types";
import { Chunk, Deferred, Effect, Fiber, Stream } from "effect";
import { describe, it } from "vite-plus/test";
import { renderToStream } from "./render-to-stream";
import { renderToString } from "./render-to-string";

const run = (node: JSXNode) => Effect.runPromise(Stream.mkString(renderToStream(node)));

// Set OBSERVE_STREAM=1 to watch the HTML accumulate chunk-by-chunk in real time.
const OBSERVE = process.env.OBSERVE_STREAM === "1";

describe("renderToStream - serialization parity", () => {
  it("renders elements, attributes, and escaped text", async () => {
    assert.equal(
      await run(<p>{"hello <b> & 'world'"}</p>),
      "<p>hello &lt;b&gt; &amp; &#x27;world&#x27;</p>",
    );
    assert.equal(await run(<div />), "<div></div>");
    assert.equal(
      await run(
        <div>
          <span>a</span>b
        </div>,
      ),
      "<div><span>a</span>b</div>",
    );
    assert.equal(
      await run(<a href={'x"&<>y'}>link</a>),
      '<a href="x&quot;&amp;&lt;&gt;y">link</a>',
    );
    assert.equal(await run(<input disabled={true} />), '<input disabled="">');
    assert.equal(await run(<input disabled={false} />), "<input>");
  });

  it("serializes style strings and objects", async () => {
    assert.equal(await run(<div style="color: red" />), '<div style="color: red"></div>');
    assert.equal(
      await run(<div style={{ backgroundColor: "blue", fontWeight: 700 }} />),
      '<div style="background-color: blue; font-weight: 700"></div>',
    );
  });

  it("resolves reactive attributes to their last emission", async () => {
    assert.equal(await run(<div id={Stream.make("a", "b", "c")} />), '<div id="c"></div>');
    assert.equal(await run(<div id={Effect.succeed("eff")} />), '<div id="eff"></div>');
  });

  it("renders void elements without a closing tag", async () => {
    assert.equal(await run(<br />), "<br>");
    assert.equal(await run(<img src="/a.png" />), '<img src="/a.png">');
  });

  it("AC-EQ1: stream output equals renderToString output", async () => {
    const node = (
      <div id={Stream.make("x", "y")}>
        <span>a</span>
        {[1, 2, 3]}
        {Effect.succeed(<em>e</em>)}
      </div>
    );
    const fromStream = await Effect.runPromise(Stream.mkString(renderToStream(node)));
    const fromString = await Effect.runPromise(renderToString(node));
    assert.equal(fromStream, fromString);
  });
});

describe("renderToStream - streaming behavior", () => {
  it("AC-ST1: emits chunks in document order", async () => {
    const chunks = await Effect.runPromise(
      Stream.runCollect(
        renderToStream(
          <div>
            <span>a</span>b
          </div>,
        ),
      ),
    );
    assert.deepEqual(Chunk.toReadonlyArray(chunks), [
      "<div>",
      "<span>",
      "a",
      "</span>",
      "b",
      "</div>",
    ]);
  });

  it("AC-ST2: empty/boolean/null nodes contribute no chunks", async () => {
    for (const node of [null, undefined, true, false] as JSXNode[]) {
      const chunks = await Effect.runPromise(Stream.runCollect(renderToStream(node)));
      assert.equal(Chunk.size(chunks), 0);
    }
  });

  it("AC-ST3: flushes shell chunks before a delayed node resolves", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const reached = yield* Deferred.make<void>();
        const collected: string[] = [];

        const slow = Effect.gen(function* () {
          yield* Deferred.succeed(reached, undefined);
          yield* Deferred.await(gate);
          return "late";
        });

        const node = (
          <div>
            <span>shell</span>
            {slow}
          </div>
        );

        const fiber = yield* Effect.fork(
          Stream.runForEach(renderToStream(node), (chunk) =>
            Effect.sync(() => {
              collected.push(chunk);
            }),
          ),
        );

        yield* Deferred.await(reached);
        const beforeGate = collected.join("");
        assert.ok(beforeGate.includes("<span>shell</span>"), "shell flushed before delay resolved");
        assert.ok(!beforeGate.includes("late"), "delayed content not yet emitted");

        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(fiber);
        assert.equal(collected.join(""), "<div><span>shell</span>late</div>");
      }),
    );
  });

  it("AC-ST4: fails the stream on an unsupported node type", async () => {
    const result = await Effect.runPromiseExit(
      Stream.runDrain(renderToStream({ type: () => null, props: {} } as unknown as JSXNode)),
    );
    assert.equal(result._tag, "Failure");
  });

  it("AC-ST5: builds a large tree with staggered async branches in document order", async () => {
    const delayed = (millis: number, node: JSXNode): JSXNode =>
      Effect.succeed(node).pipe(Effect.delay(`${millis} millis`));

    const tree = (
      <html>
        <head>
          <title>Streaming demo</title>
        </head>
        <body>
          <header>
            <h1>Shell</h1>
          </header>
          <main>
            {delayed(40, <section id="a">branch A</section>)}
            {delayed(120, <section id="b">branch B</section>)}
            <ul>
              {[1, 2, 3].map((n) => (
                <li>item {n}</li>
              ))}
            </ul>
            {delayed(80, <footer>branch C</footer>)}
          </main>
        </body>
      </html>
    );

    let html = "";
    const result = await Effect.runPromise(
      renderToStream(tree).pipe(
        Stream.tap((chunk) =>
          Effect.sync(() => {
            html += chunk;
          }).pipe(
            Effect.zipRight(
              OBSERVE ? Effect.log(`+${JSON.stringify(chunk)} | so far: ${html}`) : Effect.void,
            ),
          ),
        ),
        Stream.mkString,
      ),
    );

    // Rendering is document-order (sequential flatMap, concurrency 1), so branch B's
    // 120ms delay blocks footer C even though C is "faster" — order is by tree
    // position, not completion time.
    assert.equal(result, html);
    assert.ok(result.startsWith("<html>") && result.endsWith("</html>"));
    assert.ok(result.includes('<section id="a">branch A</section>'));
    assert.ok(result.includes('<section id="b">branch B</section>'));
    assert.ok(result.includes("<footer>branch C</footer>"));
    assert.ok(result.indexOf('id="b"') < result.indexOf("branch C"));
  });
});
