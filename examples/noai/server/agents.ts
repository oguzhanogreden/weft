/**
 * The two agent loops. Both run server side, because a browser cannot hold an
 * API credential (see `src/specs.md`, AC-NO-KEY-IN-CLIENT).
 *
 * The crawler is given one narrow tool that fetches this example's own SSR route.
 * It is not told what the signal says: it fetches, reads, and reports, which is
 * what makes the dialogue a real observation rather than a staged one (AC-FETCH).
 *
 * Both loops stream. That is a requirement, not an optimization: the transcript
 * is the point, and a large `max_tokens` on a non-streaming call risks an HTTP
 * timeout (AC-STREAM).
 */

import Anthropic from "@anthropic-ai/sdk";
import { Data, Effect, Option, Stream } from "effect";
import type { DialogueFrame, SignalSnapshot, Speaker } from "../src/transport";
import { fetchOwnSignal, SignalFetchError, X_ROBOTS_TAG } from "./signal";

/** Model driving both agents. */
export const MODEL = "claude-opus-5" as const;

/**
 * Output ceiling per turn. Streaming, so the large value carries no timeout risk.
 */
export const MAX_TOKENS: number = 2048;

/** Name of the crawler's single tool, as the model sees it. */
export const FETCH_TOOL_NAME: string = "fetch_page";

/** System prompt per agent. Exported so a test can assert neither leaks the answer. */
export const SYSTEM_PROMPT: Record<Speaker, string> = {
  // Says nothing about what the page asks for. The crawler has to fetch to find
  // out, which is the whole point of the exchange (AC-FETCH).
  crawler: [
    "You are a web crawler that collects pages for a machine-learning training corpus.",
    `Before you use a page, call the ${FETCH_TOOL_NAME} tool exactly once to fetch it.`,
    "Read the response headers and the document head, and report verbatim anything you find there about automated use.",
    "Then say plainly whether you will keep the page or drop it, and why.",
    "Two or three sentences per message. No preamble.",
  ].join(" "),
  site: [
    "You speak for a website that does not want its content used for AI training or AI image generation.",
    "The site publishes that preference in an HTTP response header and in a meta tag in the document head.",
    "You are talking to a crawler that has just fetched your page.",
    "Be accurate about what the preference is: a request written where a crawler will see it, not a mechanism that stops anything.",
    "Two or three sentences per message. No preamble.",
  ].join(" "),
};

/** Maximum exchanges before the dialogue is ended, so it cannot run away. */
export const MAX_EXCHANGES: number = 6;

/** A model call failed, or the credential was rejected. */
export class AgentError extends Data.TaggedError("AgentError")<{
  readonly speaker: Speaker;
  readonly reason: string;
}> {}

/**
 * A model declined the request. Distinct from {@link AgentError}: a refusal is a
 * normal 200 response carrying `stop_reason: "refusal"`, and it renders as a
 * visible turn rather than an error (AC-REFUSAL).
 */
export class AgentRefusal extends Data.TaggedError("AgentRefusal")<{
  readonly speaker: Speaker;
  readonly category: string | undefined;
}> {}

/** Whether a usable credential resolved, deciding scripted vs live (AC-SCRIPTED). */
export const hasCredential = (): Effect.Effect<boolean> =>
  Effect.sync(() => {
    const credential = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
    return credential !== undefined && credential.length > 0;
  });

/** Options for {@link runDialogue}. */
export interface DialogueOptions {
  /** Origin the crawler's fetch tool targets: this server's own address. */
  readonly origin: string;
  /** Defaults to {@link MAX_EXCHANGES}. */
  readonly maxExchanges?: number;
  /**
   * Base URL for the model API, overriding the SDK's own resolution.
   *
   * A test seam, and the reason it is part of the surface: {@link AgentError} and
   * {@link AgentRefusal} are otherwise unreachable without a real credential, so
   * the refusal path could never be asserted. The client is therefore built per
   * call rather than once at module scope.
   */
  readonly baseUrl?: string;
}

/** One entry of the running conversation, as both agents see it. */
type Exchange = { readonly speaker: Speaker; readonly text: string };

/**
 * Says only that there is a page and that its head and headers are worth
 * reading. Naming the directive here would give the crawler the answer as surely
 * as putting it in the prompt.
 */
const FETCH_TOOL = {
  name: FETCH_TOOL_NAME,
  description:
    "Fetch the page under discussion. Returns the HTTP status, the response headers, and the contents of the document head.",
  input_schema: { type: "object" as const, properties: {} },
};

const OPENING = "Begin.";

let sequence = 0;

const nextId = (label: string): string => `${label}-${++sequence}`;

const otherSpeaker = (speaker: Speaker): Speaker => (speaker === "crawler" ? "site" : "crawler");

/**
 * The conversation from one agent's point of view: its own turns are assistant
 * turns, the other's are user turns. A leading user message is prepended when
 * needed, because the API rejects a conversation that opens with an assistant.
 */
const conversation = (speaker: Speaker, history: ReadonlyArray<Exchange>) => {
  const mapped = history.map((entry) => ({
    role: entry.speaker === speaker ? ("assistant" as const) : ("user" as const),
    content: entry.text,
  }));
  const first = mapped[0];
  return first === undefined || first.role === "assistant"
    ? [{ role: "user" as const, content: OPENING }, ...mapped]
    : mapped;
};

/** What the crawler saw, in the shape it reports to the transcript and the model. */
const describeSnapshot = (snapshot: SignalSnapshot): string =>
  [
    `HTTP ${snapshot.status}`,
    `${X_ROBOTS_TAG}: ${Option.getOrElse(snapshot.xRobotsTag, () => "(absent)")}`,
    `<meta name="robots">: ${Option.getOrElse(snapshot.robotsMeta, () => "(absent)")}`,
  ].join("\n");

type ModelStream = ReturnType<Anthropic["messages"]["stream"]>;

/**
 * Text deltas of one model call, as turn frames. The turn is started on the
 * first delta rather than up front, so a response that only calls a tool leaves
 * no empty turn in the transcript.
 */
async function* textFrames(
  stream: ModelStream,
  speaker: Speaker,
): AsyncGenerator<DialogueFrame, boolean> {
  const id = nextId(speaker);
  let started = false;
  for await (const event of stream) {
    if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") {
      continue;
    }
    if (!started) {
      started = true;
      yield { _tag: "TurnStarted", id, speaker, kind: "message" };
    }
    yield { _tag: "TurnDelta", id, text: event.delta.text };
  }
  if (started) {
    yield { _tag: "TurnCompleted", id };
  }
  return started;
}

/** One whole turn: the round-trip through the fetch tool, then the reply. */
async function* turnFrames(
  speaker: Speaker,
  history: ReadonlyArray<Exchange>,
  options: DialogueOptions,
): AsyncGenerator<DialogueFrame> {
  try {
    // Per call, not once at module scope: `baseUrl` must be able to take effect.
    const client = new Anthropic({ baseURL: options.baseUrl });
    const messages = conversation(speaker, history);
    // No `thinking` parameter. Adaptive thinking is the default on this model, and
    // the pinned SDK's `ThinkingConfigParam` is `Enabled | Disabled` only, where
    // `Enabled` requires the `budget_tokens` this model rejects. Omitting it is
    // therefore both the correct behaviour and the only expressible one.
    const shared = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT[speaker],
    };

    const first = client.messages.stream(
      speaker === "crawler"
        ? { ...shared, messages, tools: [FETCH_TOOL] }
        : { ...shared, messages },
    );
    yield* textFrames(first, speaker);

    // Checked before `content` is read: a refusal is a normal 200 response.
    const opening = await first.finalMessage();
    if (opening.stop_reason === "refusal") {
      throw new AgentRefusal({ speaker, category: undefined });
    }

    const toolUse = opening.content.find((block) => block.type === "tool_use");
    if (toolUse === undefined || toolUse.type !== "tool_use") {
      return;
    }

    // The round-trip is shown, not summarized: the transcript must not jump from
    // question to conclusion (AC-TOOL-TURN).
    const callId = nextId("fetch-call");
    yield { _tag: "TurnStarted", id: callId, speaker, kind: "fetch-call" };
    yield { _tag: "TurnDelta", id: callId, text: `GET ${options.origin}/` };
    yield { _tag: "TurnCompleted", id: callId };

    const snapshot = await Effect.runPromise(fetchOwnSignal(options.origin)).catch(
      (cause: unknown) => {
        throw new SignalFetchError({ reason: `the fetch tool failed: ${String(cause)}` });
      },
    );
    const observed = describeSnapshot(snapshot);

    const resultId = nextId("fetch-result");
    yield { _tag: "TurnStarted", id: resultId, speaker, kind: "fetch-result" };
    yield { _tag: "TurnDelta", id: resultId, text: observed };
    yield { _tag: "TurnCompleted", id: resultId };
    yield { _tag: "SignalObserved", signal: snapshot };

    const second = client.messages.stream({
      ...shared,
      tools: [FETCH_TOOL],
      messages: [
        ...messages,
        { role: "assistant" as const, content: opening.content },
        {
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: observed,
            },
          ],
        },
      ],
    });
    yield* textFrames(second, speaker);

    const closing = await second.finalMessage();
    if (closing.stop_reason === "refusal") {
      throw new AgentRefusal({ speaker, category: undefined });
    }
  } catch (cause) {
    if (cause instanceof AgentRefusal || cause instanceof SignalFetchError) {
      throw cause;
    }
    throw new AgentError({ speaker, reason: String(cause) });
  }
}

/** Whether a caught value is already one of this module's failures. */
const isKnownFailure = (error: unknown): error is AgentError | AgentRefusal | SignalFetchError =>
  error instanceof AgentError || error instanceof AgentRefusal || error instanceof SignalFetchError;

/** The exchange, with every failure folded into a terminal frame. */
async function* dialogueFrames(options: DialogueOptions): AsyncGenerator<DialogueFrame> {
  const budget = options.maxExchanges ?? MAX_EXCHANGES;
  const history: Array<Exchange> = [];
  let speaker: Speaker = "crawler";

  try {
    for (let exchange = 0; exchange < budget; exchange++) {
      // Accumulated per `message` turn, then joined. One exchange yields the
      // fetch-call and fetch-result turns too, and folding those in would send
      // the other agent `"…check what it asks for.GET http://…/HTTP 200\n…"`, the
      // agent's own words glued to raw HTTP narration. It can also yield *two*
      // message turns, before and after the tool call, which is why the segments
      // are joined with a blank line rather than concatenated: run together they
      // read as one broken sentence. This string is conversation history for the
      // next model call, not display text, so either corruption reaches the API.
      const spoken = new Map<string, string>();
      for await (const frame of turnFrames(speaker, history, options)) {
        if (frame._tag === "TurnStarted" && frame.kind === "message") {
          spoken.set(frame.id, "");
        }
        if (frame._tag === "TurnDelta") {
          const sofar = spoken.get(frame.id);
          if (sofar !== undefined) {
            spoken.set(frame.id, sofar + frame.text);
          }
        }
        yield frame;
      }
      const spoke = spoken.size > 0;
      const text = [...spoken.values()].filter((segment) => segment.trim() !== "").join("\n\n");
      if (!spoke || text.trim() === "") {
        yield {
          _tag: "DialogueEnded",
          reason: `the ${speaker} agent stopped without replying`,
        };
        return;
      }
      history.push({ speaker, text });
      speaker = otherSpeaker(speaker);
    }
    yield {
      _tag: "DialogueEnded",
      reason: `the exchange reached its limit of ${budget} turns`,
    };
  } catch (cause) {
    if (cause instanceof AgentRefusal) {
      // Visible, not dropped, and not thrown (AC-REFUSAL).
      const id = nextId("refusal");
      yield { _tag: "TurnStarted", id, speaker: cause.speaker, kind: "refusal" };
      yield { _tag: "TurnDelta", id, text: "This agent declined to continue." };
      yield { _tag: "TurnCompleted", id };
      yield { _tag: "DialogueEnded", reason: "an agent declined to continue" };
      return;
    }
    // `AgentRefusal` is handled above and carries no `reason`, so it is not part
    // of this narrowing.
    const reason =
      cause instanceof AgentError || cause instanceof SignalFetchError
        ? cause.reason
        : String(cause);
    // A visible turn before the terminal frame. `DialogueFailed` alone only moves
    // the status pill, which leaves the transcript ending mid-sentence with no
    // statement of what went wrong (AC-TRANSPORT-ERROR asks for a terminal
    // transcript entry, not just a terminal state). `SignalFetchError` is thrown
    // only from the crawler's fetch tool, so it is attributed to the crawler.
    const id = nextId("error");
    yield {
      _tag: "TurnStarted",
      id,
      speaker: cause instanceof AgentError ? cause.speaker : "crawler",
      kind: "error",
    };
    yield { _tag: "TurnDelta", id, text: `The dialogue stopped: ${reason}` };
    yield { _tag: "TurnCompleted", id };
    yield { _tag: "DialogueFailed", reason };
  }
}

/**
 * Run the crawler/site exchange, emitting wire frames as they are produced.
 *
 * The stream is the server's whole contract with the client. It never fails: a
 * model error, a refusal, or an exhausted exchange budget is emitted as a
 * terminal frame instead, so the client always sees why the dialogue stopped
 * (AC-REFUSAL / AC-TRANSPORT-ERROR).
 */
export const runDialogue = (options: DialogueOptions): Stream.Stream<DialogueFrame, never, never> =>
  Stream.fromAsyncIterable(dialogueFrames(options), (cause): never => {
    // Unreachable: `dialogueFrames` converts every failure into a terminal
    // frame, which is what makes this stream infallible.
    throw cause;
  });

/**
 * One streamed turn from one agent, as frames. Exported so a test can drive a
 * single agent without running the whole exchange.
 */
export const streamTurn = (
  speaker: Speaker,
  history: ReadonlyArray<{ readonly speaker: Speaker; readonly text: string }>,
  options: DialogueOptions,
): Stream.Stream<DialogueFrame, AgentError | AgentRefusal | SignalFetchError> =>
  Stream.fromAsyncIterable(turnFrames(speaker, history, options), (cause) =>
    isKnownFailure(cause) ? cause : new AgentError({ speaker, reason: String(cause) }),
  );
