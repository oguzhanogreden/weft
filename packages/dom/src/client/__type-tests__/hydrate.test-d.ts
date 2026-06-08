// oxlint-disable no-unused-vars
// Pins the brand-aware `hydrate` signature: a server-only `ServerTag` left in the
// app node's requirement channel `R` (e.g. a `Boundary.rpc` tag accidentally
// referenced in client `render` code) must be a compile error, while clean nodes
// and back-compat `Renderable` inputs continue to hydrate. Checked by `vp run
// check` (the package tsconfig includes `src`). See
// `core/.../__type-tests__/rpc.test-d.ts` for the underlying
// `AssertNoServerOnly` behaviour this relies on.
import { Boundary, ServerTag, h, type Node } from "@effect-ui/core";
import { Rpc } from "@effect/rpc";
import { Effect, Schema } from "effect";
import { hydrate } from "../render";

// ── Type helpers ──────────────────────────────────────────────────────────────

type CtxOf<T> = [T] extends [Effect.Effect<any, any, infer R>] ? R : never;

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface ProductShape {
  readonly name: string;
}
const StockKey = Schema.Struct({ id: Schema.Number });
const Product = Schema.Struct({ name: Schema.String });
const GetProduct = Rpc.make("GetProduct", { payload: StockKey, success: Product });

class Database extends ServerTag("Database")<Database, { readonly q: () => ProductShape }>() {}

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

// A server boundary with a clean (server-tag-free) render leaves R = never — the
// rpc handler lives server-side, never in the client requirement channel.
const discharged = Boundary.rpc(
  GetProduct,
  () => ({ id: 1 }),
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

// Same leak surfaced through a `Boundary.rpc` whose `render` references the tag.
const leaky = Boundary.rpc(
  GetProduct,
  () => ({ id: 1 }),
  (_r) => dbNode,
);
// @ts-expect-error — server-only Tag leaked into the client requirement channel R
void Effect.runPromise(hydrate(leaky, root));
