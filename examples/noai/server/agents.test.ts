/**
 * The agent configuration, and the failure paths of the dialogue loop.
 *
 * The model calls run against a local fake upstream through
 * `DialogueOptions.baseUrl`, so `AgentError` and `AgentRefusal` are reachable
 * without a credential. The SSE framing below was verified against the installed
 * `@anthropic-ai/sdk` before these tests were written: it does yield
 * `stop_reason: "refusal"`, and a 401 does surface as an authentication error. A
 * failure here therefore means the mapping to frames is wrong, not that the
 * fixture is.
 *
 * The same fixture serves the crawler's fetch target on `GET /`, so the dialogue
 * has a reachable origin and a fetch failure cannot be mistaken for a model one.
 */

import * as assert from "node:assert/strict";
import * as http from "node:http";
import { Effect, Option, Stream } from "effect";
import { describe, it } from "vite-plus/test";
import { NOAI_DIRECTIVE } from "./signal";
import {
  FETCH_TOOL_NAME,
  hasCredential,
  MAX_EXCHANGES,
  MAX_TOKENS,
  MODEL,
  runDialogue,
  streamTurn,
  SYSTEM_PROMPT,
} from "./agents";

/** Tokens that would give the crawler the answer instead of letting it fetch. */
const SIGNAL_GIVEAWAYS = ["noai", "noimageai", "x-robots-tag"];

const sse = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A complete streamed response whose only outcome is a refusal. */
const REFUSAL_SSE =
  sse("message_start", {
    type: "message_start",
    message: {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    },
  }) +
  sse("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  }) +
  sse("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "I decline." },
  }) +
  sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
  sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "refusal", stop_sequence: null },
    usage: { output_tokens: 4 },
  }) +
  sse("message_stop", { type: "message_stop" });

/**
 * The page the crawler's fetch tool reads. Written out rather than built with
 * `injectRobotsMeta`, so the fixture does not depend on code under test.
 */
const PAGE = `<!doctype html><html><head><meta name="robots" content="noai, noimageai"></head><body></body></html>`;

/** Turn id the tool-use fixture reports, so the `tool_result` can be matched to it. */
const TOOL_USE_ID = "toolu_fixture";

/** Text of the opening message that precedes the fixture's tool call. */
const OPENING_TEXT = "Let me check what this page asks for.";

/** Text of the closing message, after the tool result comes back. */
const CLOSING_TEXT = "It carries an opt-out, so I am dropping it.";

/** A response that says something, then calls the fetch tool. */
const TOOL_USE_SSE =
  sse("message_start", {
    type: "message_start",
    message: {
      id: "msg_tool",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    },
  }) +
  sse("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  }) +
  sse("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: OPENING_TEXT },
  }) +
  sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
  sse("content_block_start", {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: TOOL_USE_ID, name: FETCH_TOOL_NAME, input: {} },
  }) +
  sse("content_block_delta", {
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: "{}" },
  }) +
  sse("content_block_stop", { type: "content_block_stop", index: 1 }) +
  sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "tool_use", stop_sequence: null },
    usage: { output_tokens: 8 },
  }) +
  sse("message_stop", { type: "message_stop" });

/** A response that emits no text at all, so the agent never actually speaks. */
const SILENT_SSE =
  sse("message_start", {
    type: "message_start",
    message: {
      id: "msg_silent",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 1 },
    },
  }) +
  sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 1 },
  }) +
  sse("message_stop", { type: "message_stop" });

/** A plain reply, used as the second call's response after a tool result. */
const CLOSING_SSE =
  sse("message_start", {
    type: "message_start",
    message: {
      id: "msg_closing",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 9, output_tokens: 1 },
    },
  }) +
  sse("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  }) +
  sse("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: CLOSING_TEXT },
  }) +
  sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
  sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 9 },
  }) +
  sse("message_stop", { type: "message_stop" });

interface Upstream {
  readonly baseUrl: string;
  /** Requests the fixture received, so a test can prove the seam was honored. */
  readonly requested: ReadonlyArray<string>;
  /** Parsed bodies of the model calls, in order, so a test can read what was sent. */
  readonly bodies: ReadonlyArray<Record<string, unknown>>;
  readonly close: () => Promise<void>;
}

/** Serves the model API and the crawler's fetch target from one origin. */
const startUpstream = async (
  mode: "refusal" | "unauthorized" | "tool-use" | "silent",
): Promise<Upstream> => {
  const requested: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    requested.push(`${request.method ?? "?"} ${request.url ?? ""}`);
    if ((request.url ?? "").startsWith("/v1/")) {
      const chunks: Array<Buffer> = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        try {
          bodies.push(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
        } catch {
          // A body the test does not care about must not kill the fixture.
        }
        if (mode === "unauthorized") {
          response.writeHead(401, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              type: "error",
              error: { type: "authentication_error", message: "credential rejected" },
            }),
          );
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (mode === "refusal") {
          response.end(REFUSAL_SSE);
          return;
        }
        if (mode === "silent") {
          response.end(SILENT_SSE);
          return;
        }
        // First call asks for the tool; every later call replies in plain text.
        response.end(bodies.length === 1 ? TOOL_USE_SSE : CLOSING_SSE);
      });
      return;
    }
    request.resume();
    response.writeHead(200, { "content-type": "text/html", "x-robots-tag": "noai, noimageai" });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("upstream fixture did not bind a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requested,
    bodies,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
};

/**
 * Runs `body` with a placeholder credential in the environment, restoring it
 * after. The fake upstream never validates the key; the SDK only refuses to
 * construct a client without one.
 */
const withPlaceholderCredential = async <A>(body: () => Promise<A>): Promise<A> => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "unit-test-placeholder";
  try {
    return await body();
  } finally {
    if (previous === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  }
};

/** Run one fixture-backed case, closing the fixture whatever happens. */
const againstUpstream = async <A>(
  mode: "refusal" | "unauthorized" | "tool-use" | "silent",
  body: (upstream: Upstream) => Promise<A>,
): Promise<A> => {
  const upstream = await startUpstream(mode);
  try {
    return await withPlaceholderCredential(() => body(upstream));
  } finally {
    await upstream.close();
  }
};

describe("model configuration", () => {
  it("drives both agents with claude-opus-5", () => {
    assert.equal(MODEL, "claude-opus-5");
  });

  it("allows a large output ceiling, which streaming makes safe", () => {
    assert.equal(Number.isInteger(MAX_TOKENS), true);
    assert.ok(MAX_TOKENS > 0);
  });

  it("bounds the exchange so the dialogue cannot run away", () => {
    assert.equal(Number.isInteger(MAX_EXCHANGES), true);
    assert.ok(MAX_EXCHANGES > 0);
  });

  it("names the fetch tool in the shape the API accepts", () => {
    assert.match(FETCH_TOOL_NAME, /^[a-zA-Z0-9_-]{1,64}$/);
  });
});

describe("AC-FETCH: the crawler is not told what it will find", () => {
  it("has a prompt per speaker, and they differ", () => {
    assert.ok(SYSTEM_PROMPT.crawler.length > 0);
    assert.ok(SYSTEM_PROMPT.site.length > 0);
    assert.notEqual(SYSTEM_PROMPT.crawler, SYSTEM_PROMPT.site);
  });

  it("never describes the signal to the crawler", () => {
    // The dialogue is only a real observation if the crawler discovers the
    // directive by fetching. A prompt that names it turns the exchange into a
    // staged one, and no other test would notice.
    const prompt = SYSTEM_PROMPT.crawler.toLowerCase();
    for (const giveaway of SIGNAL_GIVEAWAYS) {
      assert.equal(prompt.includes(giveaway), false, `crawler prompt mentions "${giveaway}"`);
    }
  });
});

describe("AC-SCRIPTED: credential detection decides the transport", () => {
  /** Runs `body` with the two credential variables set exactly as given. */
  const withEnv = async <A>(
    env: { readonly key?: string; readonly token?: string },
    body: () => Promise<A>,
  ): Promise<A> => {
    const previous = {
      key: process.env.ANTHROPIC_API_KEY,
      token: process.env.ANTHROPIC_AUTH_TOKEN,
    };
    const apply = (value: string | undefined, name: string): void => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };
    apply(env.key, "ANTHROPIC_API_KEY");
    apply(env.token, "ANTHROPIC_AUTH_TOKEN");
    try {
      return await body();
    } finally {
      apply(previous.key, "ANTHROPIC_API_KEY");
      apply(previous.token, "ANTHROPIC_AUTH_TOKEN");
    }
  };

  const detect = () => Effect.runPromise(hasCredential());

  // The previous version of this block asserted only `typeof answer === "boolean"`,
  // which held for `Effect.succeed(false)`. Verified: stubbing `hasCredential` to
  // a constant left the whole suite green, so the function that chooses live vs
  // scripted had no real coverage.
  it("reports a credential when ANTHROPIC_API_KEY is set", async () => {
    assert.equal(await withEnv({ key: "sk-test" }, detect), true);
  });

  it("falls back to ANTHROPIC_AUTH_TOKEN when the key is absent", async () => {
    assert.equal(await withEnv({ token: "tok-test" }, detect), true);
  });

  it("reports no credential when neither variable is set", async () => {
    assert.equal(await withEnv({}, detect), false);
  });

  it("treats an empty value as no credential, not as a usable one", async () => {
    // An exported-but-empty variable is the shape a half-configured shell leaves
    // behind. Reading it as present would send a live run into a 401.
    assert.equal(await withEnv({ key: "" }, detect), false);
    assert.equal(await withEnv({ token: "" }, detect), false);
  });
});

describe("the baseUrl seam is actually honored", () => {
  it("routes the model call to the supplied base URL", async () => {
    // Without this, an implementation that ignores `baseUrl` (a client built
    // once at module scope, or one reading ANTHROPIC_BASE_URL instead) would
    // reach the real API and every test below would pass or fail for reasons
    // that have nothing to do with the mapping they claim to assert.
    const seen = await againstUpstream("refusal", async (upstream) => {
      await Effect.runPromise(
        Effect.flip(
          Stream.runCollect(
            streamTurn("site", [], { origin: upstream.baseUrl, baseUrl: upstream.baseUrl }),
          ),
        ),
      );
      return [...upstream.requested];
    });
    assert.ok(
      seen.includes("POST /v1/messages"),
      `the fixture saw ${JSON.stringify(seen)}, so the model call went elsewhere`,
    );
  });
});

describe("AC-REFUSAL: a model that declines is a distinct outcome", () => {
  it("fails streamTurn with AgentRefusal, naming the speaker", async () => {
    const error = await againstUpstream("refusal", (upstream) =>
      Effect.runPromise(
        Effect.flip(
          Stream.runCollect(
            streamTurn("site", [], { origin: upstream.baseUrl, baseUrl: upstream.baseUrl }),
          ),
        ),
      ),
    );
    // Distinct from AgentError on purpose: a refusal is a normal 200, and
    // collapsing the two would render it as a transport failure.
    assert.ok(error._tag === "AgentRefusal", `expected AgentRefusal, got ${error._tag}`);
    assert.equal(error.speaker, "site");
  });

  it("reaches the client as a visible turn, never as a stream failure", async () => {
    const frames = await againstUpstream("refusal", (upstream) =>
      Effect.runPromise(
        Stream.runCollect(
          runDialogue({ origin: upstream.baseUrl, baseUrl: upstream.baseUrl, maxExchanges: 1 }),
        ),
      ),
    );
    const refusal = frames.find(
      (frame) => frame._tag === "TurnStarted" && frame.kind === "refusal",
    );
    assert.ok(refusal, `no refusal turn among ${frames.map((f) => f._tag).join(", ")}`);
    const last = frames.at(-1);
    assert.ok(last);
    assert.ok(
      last._tag === "DialogueEnded" || last._tag === "DialogueFailed",
      `expected a terminal frame, got ${last._tag}`,
    );
  });
});

describe("AC-TOOL-TURN / AC-FETCH: the tool-use round trip", () => {
  // Until this fixture existed, the whole tool-use path in `turnFrames` (finding
  // the `tool_use` block, emitting the two turns, building the `tool_result` for
  // the second call) had no coverage: the other fixtures only refuse or 401, and
  // the scripted transport never runs `agents.ts` at all. A malformed
  // `tool_result` would have 400'd on every real dialogue with the suite green.
  const toolUse = <A>(body: (upstream: Upstream) => Promise<A>) =>
    againstUpstream("tool-use", body);

  const framesOf = (upstream: Upstream) =>
    Effect.runPromise(
      Stream.runCollect(
        streamTurn("crawler", [], { origin: upstream.baseUrl, baseUrl: upstream.baseUrl }),
      ),
    );

  it("emits the fetch call and its result as their own crawler turns", async () => {
    const frames = await toolUse(framesOf);
    const kinds = frames
      .filter((frame) => frame._tag === "TurnStarted")
      .map((frame) => (frame._tag === "TurnStarted" ? frame.kind : ""));
    assert.deepEqual(kinds, ["message", "fetch-call", "fetch-result", "message"]);
    for (const frame of frames) {
      if (frame._tag === "TurnStarted") {
        assert.equal(frame.speaker, "crawler");
      }
    }
  });

  it("reports the real fetched signal in the fetch-result turn", async () => {
    const frames = await toolUse(framesOf);
    const started = frames.find(
      (frame) => frame._tag === "TurnStarted" && frame.kind === "fetch-result",
    );
    assert.ok(started?._tag === "TurnStarted");
    const text = frames
      .filter((frame) => frame._tag === "TurnDelta" && frame.id === started.id)
      .map((frame) => (frame._tag === "TurnDelta" ? frame.text : ""))
      .join("");
    // Read off the fixture's own response, not described to the model up front.
    assert.match(text, /HTTP 200/);
    assert.match(text, /noai, noimageai/);
  });

  it("emits SignalObserved carrying what the fetch actually saw", async () => {
    const frames = await toolUse(framesOf);
    const observed = frames.find((frame) => frame._tag === "SignalObserved");
    assert.ok(observed?._tag === "SignalObserved");
    assert.equal(observed.signal.status, 200);
    assert.equal(Option.getOrThrow(observed.signal.xRobotsTag), NOAI_DIRECTIVE);
    assert.equal(Option.getOrThrow(observed.signal.robotsMeta), NOAI_DIRECTIVE);
  });

  it("answers the tool call with a tool_result carrying the model's own tool id", async () => {
    const bodies = await toolUse(async (upstream) => {
      await framesOf(upstream);
      return upstream.bodies;
    });
    assert.equal(bodies.length, 2, "the tool call should trigger a second model call");
    const second = bodies[1];
    assert.ok(second, "a second request body should have been recorded");
    const messages = second.messages;
    assert.ok(Array.isArray(messages));
    // Assistant turn carrying the tool_use, then a user turn carrying its result:
    // the pairing the API requires, with the id echoed from the model's own block.
    const results = messages.flatMap((message: unknown) => {
      const content = (message as { content?: unknown }).content;
      return Array.isArray(content)
        ? content.filter((block: unknown) => (block as { type?: unknown }).type === "tool_result")
        : [];
    });
    assert.equal(results.length, 1, "exactly one tool_result should be sent");
    assert.equal((results[0] as { tool_use_id?: unknown }).tool_use_id, TOOL_USE_ID);
    assert.match(String((results[0] as { content?: unknown }).content), /noai, noimageai/);
  });

  it("keeps fetch narration out of the conversation history it sends the other agent", async () => {
    // The accumulator used to fold every TurnDelta into one string, so the site
    // agent received the crawler's words glued to `GET http://…/` and the raw
    // HTTP snapshot, with no separator. That string is API input, not display
    // text, so the corruption reached the model rather than only the page.
    const bodies = await toolUse(async (upstream) => {
      await Effect.runPromise(
        Stream.runCollect(
          runDialogue({ origin: upstream.baseUrl, baseUrl: upstream.baseUrl, maxExchanges: 2 }),
        ),
      );
      return upstream.bodies;
    });
    const sent = JSON.stringify(bodies.at(-1));
    assert.ok(sent.includes(CLOSING_TEXT), "the agent's own words should be carried over");
    assert.ok(!sent.includes("GET http"), "the fetch-call narration must not be history");
    assert.ok(!sent.includes("HTTP 200"), "the fetch-result narration must not be history");
    // Both message segments are kept, and separated. One exchange produces a
    // message before the tool call and another after it; concatenating them
    // yields `"…asks for.It carries an opt-out…"`, one broken sentence.
    assert.ok(sent.includes(OPENING_TEXT), "the pre-tool message should be carried over too");
    assert.ok(
      !sent.includes(`${OPENING_TEXT}${CLOSING_TEXT}`),
      "the two message segments must not be run together",
    );
  });
});

describe("an agent that says nothing ends the exchange rather than hanging", () => {
  // The `!spoke || text.trim() === ""` branch was untested while the expression
  // controlling it was rewritten at `/review-step`. A model that returns no text
  // must end the dialogue as data, not push an empty turn into history and keep
  // trading turns with the other agent.
  it("ends the dialogue when the model returns no text", async () => {
    const frames = await againstUpstream("silent", (upstream) =>
      Effect.runPromise(
        Stream.runCollect(
          runDialogue({ origin: upstream.baseUrl, baseUrl: upstream.baseUrl, maxExchanges: 4 }),
        ),
      ),
    );
    const last = frames.at(-1);
    assert.ok(last?._tag === "DialogueEnded", `expected DialogueEnded, got ${last?._tag}`);
    assert.match(last.reason, /without replying/);
    // Ended on the first exchange rather than burning the whole budget on an
    // agent that never speaks.
    assert.equal(
      frames.filter((frame) => frame._tag === "TurnStarted").length,
      0,
      "a silent response should open no turn",
    );
  });
});

describe("AC-TRANSPORT-ERROR: a rejected credential is data, not a crash", () => {
  it("fails streamTurn with AgentError, naming the speaker", async () => {
    const error = await againstUpstream("unauthorized", (upstream) =>
      Effect.runPromise(
        Effect.flip(
          Stream.runCollect(
            streamTurn("crawler", [], { origin: upstream.baseUrl, baseUrl: upstream.baseUrl }),
          ),
        ),
      ),
    );
    assert.ok(error._tag === "AgentError", `expected AgentError, got ${error._tag}`);
    assert.equal(error.speaker, "crawler");
    assert.ok(error.reason.length > 0, "the failure should say what went wrong");
  });

  it("ends runDialogue with DialogueFailed rather than failing the stream", async () => {
    const frames = await againstUpstream("unauthorized", (upstream) =>
      Effect.runPromise(
        Stream.runCollect(
          runDialogue({ origin: upstream.baseUrl, baseUrl: upstream.baseUrl, maxExchanges: 1 }),
        ),
      ),
    );
    const last = frames.at(-1);
    assert.ok(last, "the stream should emit at least a terminal frame");
    assert.ok(last._tag === "DialogueFailed", `expected DialogueFailed, got ${last._tag}`);
    assert.ok(last.reason.length > 0);
  });

  // The test above reads only the last frame, which is why the missing turn below
  // went unnoticed until `/e2e` looked for an `error`-kind turn to assert against.
  // `DialogueFailed` alone moves the status pill and appends nothing, so the
  // transcript ended mid-exchange with no statement of what went wrong.
  it("precedes the terminal frame with a visible error turn", async () => {
    const frames = await againstUpstream("unauthorized", (upstream) =>
      Effect.runPromise(
        Stream.runCollect(
          runDialogue({ origin: upstream.baseUrl, baseUrl: upstream.baseUrl, maxExchanges: 1 }),
        ),
      ),
    );
    const started = frames.find((frame) => frame._tag === "TurnStarted" && frame.kind === "error");
    assert.ok(started, "a failed model call should open an error turn");
    assert.ok(started._tag === "TurnStarted");
    assert.equal(started.speaker, "crawler");

    const delta = frames.find((frame) => frame._tag === "TurnDelta" && frame.id === started.id);
    assert.ok(delta?._tag === "TurnDelta", "the error turn should carry text");
    assert.ok(delta.text.length > 0, "an empty error turn tells the reader nothing");
    // Completed, so the view stops showing it as still generating.
    assert.ok(
      frames.some((frame) => frame._tag === "TurnCompleted" && frame.id === started.id),
      "the error turn should be completed",
    );
    // Order matters: the turn must land before the terminal frame, or a client
    // that stops reading at `DialogueFailed` never sees it.
    assert.ok(
      frames.findIndex((frame) => frame === started) <
        frames.findIndex((frame) => frame._tag === "DialogueFailed"),
      "the error turn should precede DialogueFailed",
    );
  });
});

describe("AC-TRANSPORT-ERROR: an exhausted budget ends the dialogue as data", () => {
  // Needs no fixture: a zero budget must be spent before any model call is made.
  const exhausted = () => runDialogue({ origin: "http://127.0.0.1:1", maxExchanges: 0 });

  it("completes instead of failing the stream", async () => {
    const frames = await Effect.runPromise(Stream.runCollect(exhausted()));
    assert.ok(Array.isArray(frames));
  });

  it("spends no model call before checking the budget", async () => {
    const frames = await Effect.runPromise(Stream.runCollect(exhausted()));
    assert.deepEqual(
      frames.filter((frame) => frame._tag === "TurnStarted"),
      [],
    );
  });

  it("says why it stopped, as a terminal frame", async () => {
    const frames = await Effect.runPromise(Stream.runCollect(exhausted()));
    const last = frames.at(-1);
    assert.ok(last, "the stream should emit at least a terminal frame");
    assert.ok(last._tag === "DialogueEnded", `expected DialogueEnded, got ${last._tag}`);
    assert.ok(last.reason.length > 0);
  });
});
