import * as assert from "node:assert/strict";
import { Suspense } from "@effect-ui/core/suspense";
import type { JSXNode } from "@effect-ui/core/types";
import { Chunk, Deferred, Effect, Fiber, Stream, SubscriptionRef } from "effect";
import { describe, it } from "vite-plus/test";
import { renderToStream, renderToStreamHydratable } from "./render-to-stream";
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

  it("AC-R1/AC-R2: resolves reactive attributes to their first/current emission", async () => {
    assert.equal(await run(<div id={Stream.make("a", "b", "c")} />), '<div id="a"></div>');
    assert.equal(await run(<div id={Effect.succeed("eff")} />), '<div id="eff"></div>');
  });

  it("AC-R4: a non-terminating reactive attribute resolves to its current value without hanging", async () => {
    const ref = await Effect.runPromise(SubscriptionRef.make("live"));
    assert.equal(await run(<div id={ref.changes} />), '<div id="live"></div>');
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
      Stream.runDrain(renderToStream({ type: 123, props: {} } as unknown as JSXNode)),
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

describe("renderToStream - function components", () => {
  it("AC-FC1/FC2: renders a component returning an element inline", async () => {
    const Greeting = () => <p>hello</p>;
    assert.equal(await run(<Greeting />), "<p>hello</p>");
  });

  it("AC-FC1: passes props verbatim to the component", async () => {
    const Greeting = ({ name }: { name: string }) => <p>hi {name}</p>;
    assert.equal(await run(<Greeting name="ada" />), "<p>hi ada</p>");
  });

  it("AC-FC2: renders a component returning a fragment", async () => {
    const Pair = () => (
      <>
        <span>a</span>
        <span>b</span>
      </>
    );
    assert.equal(await run(<Pair />), "<span>a</span><span>b</span>");
  });

  it("AC-FC3: collapses a component returning an Effect/Stream to its first/current emission", async () => {
    const FromEffect = () => Effect.succeed(<em>e</em>);
    assert.equal(await run(<FromEffect />), "<em>e</em>");

    const FromStream = () => Stream.make(<em>a</em>, <em>b</em>);
    assert.equal(await run(<FromStream />), "<em>a</em>");
  });

  it("AC-FC4: renders nested components", async () => {
    const Inner = ({ label }: { label: string }) => <span>{label}</span>;
    const Outer = () => (
      <div>
        <Inner label="x" />
        <Inner label="y" />
      </div>
    );
    assert.equal(await run(<Outer />), "<div><span>x</span><span>y</span></div>");
  });

  it("AC-FC3: hydratable wraps a component's reactive result in markers", async () => {
    const Live = () => Stream.make(<em>now</em>);
    const html = await Effect.runPromise(Stream.mkString(renderToStreamHydratable(<Live />)));
    assert.equal(html, "<!-- stream-start-1 --><em>now</em><!-- stream-end-1 -->");
  });
});

// ============================================================================
// SSR Suspense tests — AC-SS1 through AC-SS7
// ============================================================================

describe("renderToStream - Suspense SSR", () => {
  // Helper: async component backed by a Deferred gate so tests can control timing.
  function makeGatedComponent(gate: Deferred.Deferred<void>, content: JSXNode) {
    return () =>
      Effect.gen(function* () {
        yield* Deferred.await(gate);
        return content;
      });
  }

  it("AC-SS1: renderToString emits fallback only — no markers, no patches", async () => {
    const SlowChild = () => Effect.succeed(<p>resolved</p>);
    const html = await Effect.runPromise(
      renderToString(
        <Suspense fallback={<span>loading</span>}>
          <SlowChild />
        </Suspense>,
      ),
    );
    assert.equal(html, "<span>loading</span>");
    assert.ok(!html.includes("suspense-start"), "no start marker");
    assert.ok(!html.includes("suspense-end"), "no end marker");
    assert.ok(!html.includes("<template"), "no template tag");
    assert.ok(!html.includes("<script"), "no script tag");
  });

  it("AC-SS1: renderToString renders nested Suspense fallback inline", async () => {
    const html = await Effect.runPromise(
      renderToString(
        <Suspense fallback={<div>outer loading</div>}>
          <Suspense fallback={<div>inner loading</div>}>
            {Effect.succeed(<p>inner content</p>)}
          </Suspense>
        </Suspense>,
      ),
    );
    // renderToString renders only the outer fallback — the outer Suspense is
    // intercepted first (ctx=null path) and its children are never visited.
    assert.equal(
      html,
      "<div>outer loading</div>",
      "only outer fallback rendered; inner boundary never reached",
    );
    assert.ok(!html.includes("suspense-start"));
    assert.ok(!html.includes("<template"));
  });

  it("AC-SS2: renderToStream emits fallback+markers inline, patch appended after main", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const GatedChild = makeGatedComponent(gate, <p>resolved</p>);

        const chunks: string[] = [];

        const fiber = yield* Effect.fork(
          Stream.runForEach(
            renderToStream(
              <div>
                <Suspense fallback={<span>loading</span>}>
                  <GatedChild />
                </Suspense>
              </div>,
            ),
            (chunk) =>
              Effect.sync(() => {
                chunks.push(chunk);
              }),
          ),
        );

        // Yield enough to let the main stream run past the Suspense boundary
        yield* Effect.sleep("10 millis");
        const mainHtml = chunks.join("");

        // Main stream should have emitted fallback + markers
        assert.ok(mainHtml.includes("<div>"), "outer div present");
        assert.ok(mainHtml.includes("<!-- suspense-start-1 -->"), "start marker present");
        assert.ok(mainHtml.includes("<span>loading</span>"), "fallback present");
        assert.ok(mainHtml.includes("<!-- suspense-end-1 -->"), "end marker present");
        assert.ok(!mainHtml.includes("<template"), "patch not yet emitted");

        // Release the gate; the resolution fiber pushes the patch
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(fiber);

        const fullHtml = chunks.join("");
        assert.ok(fullHtml.includes('<template id="ef-s-1">'), "template patch present");
        assert.ok(fullHtml.includes("<p>resolved</p>"), "resolved content in patch");
        assert.ok(fullHtml.includes("<script>"), "swap script present");
        assert.ok(fullHtml.includes("suspense-start-1"), "start marker text in script");
        assert.ok(fullHtml.includes("suspense-end-1"), "end marker text in script");
      }),
    );
  });

  it("AC-SS2: renderToStream with sync child terminates immediately (no open tail)", async () => {
    // Sync-only content should terminate as soon as the main document is done.
    const html = await Effect.runPromise(
      Stream.mkString(
        renderToStream(
          <Suspense fallback={<span>loading</span>}>{Effect.succeed(<p>sync</p>)}</Suspense>,
        ),
      ),
    );
    // The async Effect child in the Suspense boundary resolves immediately;
    // the patch is pushed, queue is shut down, stream terminates.
    assert.ok(html.includes("<!-- suspense-start-1 -->"), "start marker");
    assert.ok(html.includes("<!-- suspense-end-1 -->"), "end marker");
    assert.ok(html.includes('<template id="ef-s-1">'), "patch emitted");
    assert.ok(html.includes("<p>sync</p>"), "content in patch");
  });

  it("AC-SS3: renderToStreamHydratable — patch includes stream markers for reactive children", async () => {
    const html = await Effect.runPromise(
      Stream.mkString(
        renderToStreamHydratable(
          <Suspense fallback={<span>loading</span>}>
            {Effect.succeed(<div>{Stream.make("live")}</div>)}
          </Suspense>,
        ),
      ),
    );
    // Patch template should contain stream markers around the reactive region
    assert.ok(html.includes('<template id="ef-s-1">'), "patch present");
    assert.ok(html.includes("stream-start-"), "reactive markers in patch content");
    assert.ok(html.includes("stream-end-"), "reactive end marker in patch content");
    assert.ok(html.includes("live"), "reactive value in patch content");
  });

  it("AC-SS4: multiple boundaries — patches emitted in resolution order", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const gateA = yield* Deferred.make<void>();
        const gateB = yield* Deferred.make<void>();

        const SlowA = makeGatedComponent(gateA, <p>branch A</p>);
        const SlowB = makeGatedComponent(gateB, <p>branch B</p>);

        const html = yield* Effect.gen(function* () {
          // Release B before A so B's patch should appear first
          const fiberHtml = yield* Effect.fork(
            Stream.mkString(
              renderToStream(
                <>
                  <Suspense fallback={<span>loading A</span>}>
                    <SlowA />
                  </Suspense>
                  <Suspense fallback={<span>loading B</span>}>
                    <SlowB />
                  </Suspense>
                </>,
              ),
            ),
          );

          yield* Effect.sleep("5 millis");
          // Release B first (resolves before A)
          yield* Deferred.succeed(gateB, undefined);
          yield* Effect.sleep("5 millis");
          yield* Deferred.succeed(gateA, undefined);

          return yield* Fiber.join(fiberHtml);
        });

        // Both patches must be present
        assert.ok(html.includes('<template id="ef-s-1">'), "patch for boundary 1");
        assert.ok(html.includes('<template id="ef-s-2">'), "patch for boundary 2");
        assert.ok(html.includes("<p>branch A</p>"), "branch A resolved");
        assert.ok(html.includes("<p>branch B</p>"), "branch B resolved");

        // B resolved first so its patch should precede A's in the output
        const idxB = html.indexOf('<template id="ef-s-2">');
        const idxA = html.indexOf('<template id="ef-s-1">');
        assert.ok(idxB < idxA, "B patch emitted before A patch (resolution order)");
      }),
    );
  });

  it("AC-SS5: nested Suspense — outer patch has inner fallback; inner patch emitted separately", async () => {
    const html = await Effect.runPromise(
      Stream.mkString(
        renderToStream(
          <Suspense fallback={<span>outer loading</span>}>
            {Effect.succeed(
              <Suspense fallback={<span>inner loading</span>}>
                {Effect.succeed(<p>inner content</p>)}
              </Suspense>,
            )}
          </Suspense>,
        ),
      ),
    );

    // Outer patch (id=1) contains inner boundary's fallback + markers
    const outerTemplateMatch = html.match(/<template id="ef-s-1">([\s\S]*?)<\/template>/);
    assert.ok(outerTemplateMatch, "outer template present");
    const outerContent = outerTemplateMatch?.[1] ?? "";
    assert.ok(outerContent.includes("suspense-start-2"), "outer patch has inner start marker");
    assert.ok(outerContent.includes("inner loading"), "outer patch has inner fallback");
    assert.ok(outerContent.includes("suspense-end-2"), "outer patch has inner end marker");

    // Inner patch (id=2) contains the actual inner content
    const innerTemplateMatch = html.match(/<template id="ef-s-2">([\s\S]*?)<\/template>/);
    assert.ok(innerTemplateMatch, "inner template present");
    const innerContent = innerTemplateMatch?.[1] ?? "";
    assert.ok(innerContent.includes("<p>inner content</p>"), "inner patch has resolved content");
  });

  it("AC-SS6: never-resolving boundary keeps stream open (no timeout)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const neverResolves = yield* Deferred.make<void>();
        const NeverChild = makeGatedComponent(neverResolves, <p>never</p>);

        const chunks: string[] = [];

        const fiber = yield* Effect.fork(
          Stream.runForEach(
            renderToStream(
              <Suspense fallback={<span>forever loading</span>}>
                <NeverChild />
              </Suspense>,
            ),
            (chunk) =>
              Effect.sync(() => {
                chunks.push(chunk);
              }),
          ),
        );

        // Wait a bit; main stream should have emitted the fallback by now
        yield* Effect.sleep("30 millis");
        const html = chunks.join("");

        assert.ok(html.includes("<!-- suspense-start-1 -->"), "start marker emitted");
        assert.ok(html.includes("<span>forever loading</span>"), "fallback emitted");
        assert.ok(html.includes("<!-- suspense-end-1 -->"), "end marker emitted");

        // Stream is still open (fiber not done) — the patch hasn't arrived
        const poll = yield* Fiber.poll(fiber);
        assert.ok(poll._tag === "None", "stream still open — patch not yet emitted");
        assert.ok(!html.includes("<template"), "no patch emitted yet");

        // Clean up — interrupt the fiber
        yield* Fiber.interrupt(fiber);
      }),
    );
  });

  it("AC-SS7: no Suspense in tree — output identical, stream terminates immediately", async () => {
    const node = (
      <div>
        <span>hello</span>
        {Effect.succeed("world")}
      </div>
    );

    const fromOldStream = "<div><span>hello</span>world</div>";
    const fromNew = await Effect.runPromise(Stream.mkString(renderToStream(node)));
    assert.equal(fromNew, fromOldStream, "output identical when no Suspense");

    // The stream must terminate — if it hangs, the test times out.
    // No additional assertion needed; the await itself verifies termination.
  });

  it("AC-SS7: no Suspense hydratable — output identical to pre-Suspense", async () => {
    const Live = () => Stream.make(<em>now</em>);
    const html = await Effect.runPromise(
      Stream.mkString(
        renderToStreamHydratable(
          <div>
            <Live />
          </div>,
        ),
      ),
    );
    assert.equal(html, "<div><!-- stream-start-1 --><em>now</em><!-- stream-end-1 --></div>");
  });
});
