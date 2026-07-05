// oxlint-disable no-unused-vars
import {
  Boundary,
  ServerTag,
  Subscribable,
  type AssertNoServerOnly,
  type Node,
} from "@weftui/core";
import { Effect, Option, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

// ── Type equality helpers ─────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type CtxOf<T> = [T] extends [Effect.Effect<any, any, infer R>] ? R : never;

// ── Fixtures ─────────────────────────────────────────────────────────────────

class FooError extends Schema.TaggedErrorClass<FooError>()("Foo", { msg: Schema.String }) {}

const StockKey = Schema.Struct({ id: Schema.Number });
const Stock = Schema.Struct({ units: Schema.Number });
type StockType = typeof Stock.Type;
type StockKeyType = typeof StockKey.Type;

// An rpc that cannot fail (Error<R> = never) and one that can.
const GetStock = Rpc.make("GetStock", { payload: StockKey, success: Stock });
const GetStockE = Rpc.make("GetStockE", { payload: StockKey, success: Stock, error: FooError });

// A server-only service used only to prove a leak into `render` is preserved in R.
class Database extends ServerTag("Database")<Database, { readonly q: () => StockType }>() {}
const dbUse = Database.pipe(Effect.map((db) => db.q()));
type DatabaseReq = CtxOf<typeof dbUse>;

// A plain (non-server) service that may legitimately appear in client R.
interface ClientService {
  readonly _tag: "ClientService";
}

declare const staticNode: Node<never, never>;
declare const clientNode: Node<never, ClientService>;
declare const dbNode: Node<never, DatabaseReq>;
declare const erroringNode: Node<FooError, never>;

// ── Success/Payload inferred from the Rpc schemas ─────────────────────────────

// `render` receives a Resource<Success<R>> (Stock), not the bare payload/key.
Boundary.rpc(
  GetStock,
  () => ({ id: 1 }),
  (resource) => {
    const _value: Subscribable.Subscribable<StockType> = resource.value;
    const _pending: Subscribable.Subscribable<boolean> = resource.pending;
    const _error: Subscribable.Subscribable<Option.Option<unknown>> = resource.error;
    const _refetch: Effect.Effect<void> = resource.refetch;
    return staticNode;
  },
);

// `render`'s arg is a Resource<Success>, not the bare Success.
Boundary.rpc(
  GetStock,
  () => ({ id: 1 }),
  // @ts-expect-error — render's arg is a Resource<Stock>, not the bare Stock
  (data: StockType) => staticNode,
);

// ── payload thunk must return the rpc's payload type (StockKey) ────────────────

// Correct payload shape compiles.
Boundary.rpc(
  GetStock,
  (): StockKeyType => ({ id: 1 }),
  (_r) => staticNode,
);

// Wrong payload shape is a compile error.
Boundary.rpc(
  GetStock,
  // @ts-expect-error — payload thunk must return { id: number }, not { id: string }
  () => ({ id: "1" }),
  (_r) => staticNode,
);

Boundary.rpc(
  GetStock,
  // @ts-expect-error — payload thunk must return the rpc payload, not an unrelated shape
  () => ({ wrong: true }),
  (_r) => staticNode,
);

// ── Output channels: render's E | Rpc.Error<R> ; context = render's R ──────────

// No rpc error, static render → Node<never, never>.
const _clean = Boundary.rpc(
  GetStock,
  () => ({ id: 1 }),
  (_r) => staticNode,
);
type _TClean = Expect<Equal<typeof _clean, Node<never, never>>>;

// rpc error joins the output error channel.
const _rpcErr = Boundary.rpc(
  GetStockE,
  () => ({ id: 1 }),
  (_r) => staticNode,
);
type _TRpcErr = Expect<Equal<typeof _rpcErr, Node<FooError, never>>>;

// render's own error joins the output error channel.
const _renderErr = Boundary.rpc(
  GetStock,
  () => ({ id: 1 }),
  (_r) => erroringNode,
);
type _TRenderErr = Expect<Equal<typeof _renderErr, Node<FooError, never>>>;

// render's R passes through untouched (no Exclude).
const _clientR = Boundary.rpc(
  GetStock,
  () => ({ id: 1 }),
  (_r) => clientNode,
);
type _TClientR = Expect<Equal<typeof _clientR, Node<never, ClientService>>>;

// A server-branded tag leaking into `render` is preserved in R (NOT erased), so
// `hydrate` can later reject it via AssertNoServerOnly.
const _leak = Boundary.rpc(
  GetStock,
  () => ({ id: 1 }),
  (_r) => dbNode,
);
type _TLeak = Expect<Equal<Node.Context<typeof _leak>, DatabaseReq>>;

// ── AssertNoServerOnly: passes clean R, rejects leaked server tags ────────────

type _TPassThrough = Expect<Equal<AssertNoServerOnly<ClientService>, ClientService>>;
type _TPassEmpty = Expect<Equal<AssertNoServerOnly<never>, never>>;
// A leaked server tag does NOT pass through unchanged (resolves to the sentinel).
type _TReject = Expect<
  Equal<AssertNoServerOnly<DatabaseReq>, DatabaseReq> extends true ? false : true
>;

// ── options.fallback is optional ──────────────────────────────────────────────

Boundary.rpc(
  GetStock,
  () => ({ id: 1 }),
  (_r) => staticNode,
  {
    fallback: staticNode,
  },
);
Boundary.rpc(
  GetStock,
  () => ({ id: 1 }),
  (_r) => staticNode,
  {},
);
