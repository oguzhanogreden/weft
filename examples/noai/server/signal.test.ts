/**
 * Both halves of the `noai` signal: the response header and the document meta
 * tag, plus reading them back the way the crawler's fetch tool does.
 *
 * Node scope on purpose. A browser-mode mount has no `<head>` from `index.html`,
 * so neither half is assertable from a mounted tree (`src/specs.md`,
 * AC-SIGNAL-HEADER / AC-SIGNAL-META).
 */

import * as assert from "node:assert/strict";
import * as http from "node:http";
import { Effect, Option } from "effect";
import { describe, it } from "vite-plus/test";
import {
  fetchOwnSignal,
  injectIntoHead,
  injectRobotsMeta,
  NOAI_DIRECTIVE,
  parseRobotsMeta,
  ROBOTS_META_TAG,
  SignalFetchError,
  snapshotFromResponse,
  withNoaiHeader,
  X_ROBOTS_TAG,
} from "./signal";

/** Matches a `robots` meta tag whatever order its attributes are written in. */
const countRobotsMetas = (html: string): number =>
  [...html.matchAll(/<meta[^>]*name=["']robots["'][^>]*>/gi)].length;

const TAGLESS = "<!doctype html><html><head><title>noai</title></head><body></body></html>";

/** A live HTTP fixture, recording the paths it was asked for. */
interface Fixture {
  readonly origin: string;
  readonly requested: ReadonlyArray<string>;
  readonly close: () => Promise<void>;
}

const startFixture = async (
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<Fixture> => {
  const requested: string[] = [];
  const server = http.createServer((request, response) => {
    requested.push(request.url ?? "");
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP fixture did not bind a TCP port");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requested,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
};

/** Serves a page carrying both halves of the signal. */
const servesSignal = (request: http.IncomingMessage, response: http.ServerResponse): void => {
  response.writeHead(200, {
    "content-type": "text/html",
    [X_ROBOTS_TAG]: NOAI_DIRECTIVE,
  });
  response.end(injectRobotsMeta(TAGLESS));
};

describe("the directive itself", () => {
  it("is the value both halves carry", () => {
    assert.equal(NOAI_DIRECTIVE, "noai, noimageai");
  });

  it("names the response header", () => {
    assert.equal(X_ROBOTS_TAG, "X-Robots-Tag");
  });

  it("is a complete meta tag carrying the directive", () => {
    assert.equal(countRobotsMetas(ROBOTS_META_TAG), 1);
    assert.ok(ROBOTS_META_TAG.includes(NOAI_DIRECTIVE));
  });
});

describe("AC-SIGNAL-HEADER: withNoaiHeader", () => {
  it("sets X-Robots-Tag to the directive", () => {
    const headers = withNoaiHeader(new Headers());
    assert.equal(headers.get(X_ROBOTS_TAG), NOAI_DIRECTIVE);
  });

  it("leaves other headers alone", () => {
    const headers = withNoaiHeader(new Headers({ "content-type": "text/html" }));
    assert.equal(headers.get("content-type"), "text/html");
  });

  it("applied twice still yields one value", () => {
    const headers = withNoaiHeader(withNoaiHeader(new Headers()));
    assert.equal(headers.get(X_ROBOTS_TAG), NOAI_DIRECTIVE);
    assert.deepEqual(
      [...headers].filter(([name]) => name.toLowerCase() === "x-robots-tag").length,
      1,
    );
  });
});

describe("injectIntoHead: the shared head-injection both call sites use", () => {
  const TAG = '<meta name="probe" content="x">';

  it("inserts at the top of a plain head", () => {
    const html = injectIntoHead("<html><head><title>t</title></head></html>", TAG);
    assert.ok(html.includes(`<head>${TAG}`));
  });

  it("inserts into a head that carries attributes", () => {
    // The bug this helper exists to prevent: a literal `replace("<head>", …)`
    // returns the document unchanged here, and both callers fail silently.
    const html = injectIntoHead('<html><head profile="x"><title>t</title></head></html>', TAG);
    assert.ok(html.includes(TAG), "the tag should have been inserted");
    assert.ok(html.indexOf(TAG) > html.indexOf("<head"), "and inserted after the head tag");
    assert.ok(html.indexOf(TAG) < html.indexOf("<title>"), "at the top of the head");
  });

  it("prepends when the document has no head", () => {
    const html = injectIntoHead("<html><body></body></html>", TAG);
    assert.ok(html.startsWith(TAG));
  });

  it("leaves the rest of the document intact", () => {
    const source = "<!doctype html><html><head></head><body>body</body></html>";
    const html = injectIntoHead(source, TAG);
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("<body>body</body>"));
  });
});

describe("AC-SIGNAL-META: injectRobotsMeta", () => {
  it("leaves a template that already carries the tag untouched", () => {
    // The primary case, because `index.html` ships with the tag: this is the
    // path production takes on every request.
    const already = injectRobotsMeta(TAGLESS);
    assert.equal(injectRobotsMeta(already), already);
    assert.equal(countRobotsMetas(already), 1);
  });

  it("injects the tag into a tag-less head, exactly once", () => {
    const html = injectRobotsMeta(TAGLESS);
    assert.equal(countRobotsMetas(html), 1);
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    assert.equal(countRobotsMetas(head), 1);
  });

  it("injects into a head that carries attributes", () => {
    // `<head>` is matched as a tag, not as a literal string. A literal
    // `replace("<head>", …)` silently returned the document unchanged here, so
    // half the signal went missing with no error and no failing test.
    const withAttributes = TAGLESS.replace("<head>", '<head profile="x">');
    assert.equal(countRobotsMetas(injectRobotsMeta(withAttributes)), 1);
  });

  it("still emits the tag for a document with no head at all", () => {
    // Prepended rather than dropped: this function has no error channel, so
    // returning the input unchanged would report success while emitting nothing.
    const headless = "<!doctype html><html><body></body></html>";
    assert.equal(countRobotsMetas(injectRobotsMeta(headless)), 1);
  });

  it("recognizes an existing tag whose attributes are written in the other order", () => {
    const reversed = TAGLESS.replace(
      "<title>noai</title>",
      `<meta content="${NOAI_DIRECTIVE}" name="robots"><title>noai</title>`,
    );
    assert.equal(countRobotsMetas(injectRobotsMeta(reversed)), 1);
  });
});

describe("AC-SIGNAL-PANEL: parseRobotsMeta reads back verbatim", () => {
  it("extracts the content attribute", async () => {
    const content = await Effect.runPromise(parseRobotsMeta(injectRobotsMeta(TAGLESS)));
    assert.equal(Option.getOrThrow(content), NOAI_DIRECTIVE);
  });

  it("does not normalize the value it found", async () => {
    const odd = TAGLESS.replace(
      "<head>",
      `<head><meta name="robots" content="noai,   NOIMAGEAI ">`,
    );
    const content = await Effect.runPromise(parseRobotsMeta(odd));
    assert.equal(Option.getOrThrow(content), "noai,   NOIMAGEAI ");
  });

  it("is None when the document carries no robots meta", async () => {
    const content = await Effect.runPromise(parseRobotsMeta(TAGLESS));
    assert.ok(Option.isNone(content));
  });

  it("ignores a meta tag with a different name", async () => {
    const other = TAGLESS.replace("<head>", `<head><meta name="viewport" content="width=100">`);
    assert.ok(Option.isNone(await Effect.runPromise(parseRobotsMeta(other))));
  });

  it("reads the content attribute written before the name attribute", async () => {
    const reversed = TAGLESS.replace(
      "<head>",
      `<head><meta content="${NOAI_DIRECTIVE}" name="robots">`,
    );
    const content = await Effect.runPromise(parseRobotsMeta(reversed));
    assert.equal(Option.getOrThrow(content), NOAI_DIRECTIVE);
  });
});

describe("AC-FETCH: snapshotFromResponse", () => {
  it("carries status, header, and meta tag together", async () => {
    const response = new Response(injectRobotsMeta(TAGLESS), {
      status: 200,
      headers: { [X_ROBOTS_TAG]: NOAI_DIRECTIVE },
    });
    const snapshot = await Effect.runPromise(snapshotFromResponse(response));
    assert.equal(snapshot.status, 200);
    assert.equal(Option.getOrThrow(snapshot.xRobotsTag), NOAI_DIRECTIVE);
    assert.equal(Option.getOrThrow(snapshot.robotsMeta), NOAI_DIRECTIVE);
  });

  it("distinguishes an absent header from an empty one", async () => {
    const absent = await Effect.runPromise(snapshotFromResponse(new Response(TAGLESS)));
    assert.ok(Option.isNone(absent.xRobotsTag));
    const empty = await Effect.runPromise(
      snapshotFromResponse(new Response(TAGLESS, { headers: { [X_ROBOTS_TAG]: "" } })),
    );
    assert.equal(Option.getOrThrow(empty.xRobotsTag), "");
  });

  it("is None for the meta tag when the body has none", async () => {
    const snapshot = await Effect.runPromise(snapshotFromResponse(new Response(TAGLESS)));
    assert.ok(Option.isNone(snapshot.robotsMeta));
  });

  it("preserves a non-200 status as a finding, not a failure", async () => {
    // The body carries the tag on purpose. With an empty body `robotsMeta` would
    // be `None` whatever the implementation did, so the test could not tell
    // "a non-200 is snapshotted" from "a non-200 skips parsing".
    const snapshot = await Effect.runPromise(
      snapshotFromResponse(
        new Response(injectRobotsMeta(TAGLESS), {
          status: 404,
          headers: { [X_ROBOTS_TAG]: NOAI_DIRECTIVE },
        }),
      ),
    );
    assert.equal(snapshot.status, 404);
    assert.equal(Option.getOrThrow(snapshot.xRobotsTag), NOAI_DIRECTIVE);
    assert.equal(Option.getOrThrow(snapshot.robotsMeta), NOAI_DIRECTIVE);
  });

  it("fails with SignalFetchError when the body cannot be read", async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("body stream broke"));
        },
      }),
    );
    const error = await Effect.runPromise(Effect.flip(snapshotFromResponse(broken)));
    assert.ok(error instanceof SignalFetchError);
    assert.equal(error._tag, "SignalFetchError");
  });
});

describe("AC-FETCH: fetchOwnSignal reads the server it runs beside", () => {
  it("snapshots both halves of a real response", async () => {
    const fixture = await startFixture(servesSignal);
    try {
      const snapshot = await Effect.runPromise(fetchOwnSignal(fixture.origin));
      assert.equal(snapshot.status, 200);
      assert.equal(Option.getOrThrow(snapshot.xRobotsTag), NOAI_DIRECTIVE);
      assert.equal(Option.getOrThrow(snapshot.robotsMeta), NOAI_DIRECTIVE);
    } finally {
      await fixture.close();
    }
  });

  it("requests the SSR route only, so the crawler cannot wander", async () => {
    const fixture = await startFixture(servesSignal);
    try {
      await Effect.runPromise(fetchOwnSignal(fixture.origin));
      assert.deepEqual([...fixture.requested], ["/"]);
    } finally {
      await fixture.close();
    }
  });

  it("fails with SignalFetchError when the origin is unreachable", async () => {
    // Bind then release, so the port is real and certain to refuse.
    const fixture = await startFixture(servesSignal);
    const origin = fixture.origin;
    await fixture.close();
    const error = await Effect.runPromise(Effect.flip(fetchOwnSignal(origin)));
    assert.ok(error instanceof SignalFetchError);
    assert.ok(error.reason.length > 0, "the failure should say what went wrong");
  });
});
