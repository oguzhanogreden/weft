// oxlint-disable no-unused-vars
// Pins the brand-aware `hydrate` signature: a server-only `ServerTag` left in the
// app node's requirement channel `R` (e.g. a `Boundary.server` tag accidentally
// referenced in client `render` code) must be a compile error, while clean nodes
// and back-compat `Renderable` inputs continue to hydrate. Checked by `vp run
// check` (the package tsconfig includes `src`). See
// `core/.../__type-tests__/server.test-d.ts` for the underlying
// `AssertNoServerOnly` behaviour this relies on.
import { Boundary, ServerTag, h, type Node } from "@effect-ui/core";
import { Effect, Layer, Schema } from "effect";
import { hydrate } from "../render";

// ── Type helpers ──────────────────────────────────────────────────────────────

type CtxOf<T> = [T] extends [Effect.Effect<any, any, infer R>] ? R : never;

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface ProductShape {
  readonly name: string;
}
const Product = Schema.Struct({ name: Schema.String });

class Database extends ServerTag("Database")<Database, { readonly q: () => ProductShape }>() {}
declare const DatabaseLive: Layer.Layer<Database>;

// A plain (non-server) service that may legitimately appear in the client R.
interface ClientService {
  readonly _tag: "ClientService";
}

declare const root: HTMLElement;
declare const clientNode: Node<never, ClientService>;
declare const dbNode: Node<never, CtxOf<typeof dbLoad>>;
const dbLoad = Database.pipe(Effect.map((db) => db.q()));

// ── Clean nodes hydrate (R free of server-only tags) ──────────────────────────

// Static node — R = never.
void Effect.runPromise(hydrate(h.div({}, "ok"), root));

// A discharged server boundary leaves R = never.
const discharged = Boundary.server(
  { id: "discharged", load: () => dbLoad, provide: DatabaseLive, schema: Product },
  () => h.div({}, "ok"),
);
void Effect.runPromise(hydrate(discharged, root));

// A plain (non-server) client requirement is allowed: hydrate returns a real
// Effect (not the `ServerOnlyLeak` string sentinel), even though running it would
// still require `ClientService` to be provided.
const clientResult = hydrate(clientNode, root);
const _clientAllowed: [typeof clientResult] extends [Effect.Effect<any, any, any>] ? true : false =
  true;

// Back-compat: a raw `Renderable` (string) still hydrates.
void Effect.runPromise(hydrate("text", root));

// ── A leaked server-only tag is rejected ──────────────────────────────────────

// `dbNode`'s R carries the server-only `Database` brand: hydrate's return type
// degrades to the `ServerOnlyLeak` sentinel, so it is not a runnable Effect.
// @ts-expect-error — server-only Tag leaked into the client requirement channel R
void Effect.runPromise(hydrate(dbNode, root));

// Same leak surfaced through a `Boundary.server` whose `render` references the tag.
const leaky = Boundary.server(
  { id: "leaky", load: () => Effect.succeed({ name: "x" }), provide: Layer.empty, schema: Product },
  (_p) => dbNode,
);
// @ts-expect-error — server-only Tag leaked into the client requirement channel R
void Effect.runPromise(hydrate(leaky, root));
