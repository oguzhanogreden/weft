// oxlint-disable no-unused-vars
import { Boundary, ServerTag, type AssertNoServerOnly, type Node } from "@effect-ui/core";
import { Effect, Layer, Schema } from "effect";

// ── Type equality helpers ─────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type CtxOf<T> = [T] extends [Effect.Effect<any, any, infer R>] ? R : never;

// ── Fixtures ─────────────────────────────────────────────────────────────────

class FooError extends Schema.TaggedError<FooError>()("Foo", { msg: Schema.String }) {}

interface ProductShape {
  readonly name: string;
}
const Product = Schema.Struct({ name: Schema.String });

// A server-only service and a layer that fully provides it.
class Database extends ServerTag("Database")<Database, { readonly q: () => ProductShape }>() {}
declare const DatabaseLive: Layer.Layer<Database>;

// The branded requirement only materialises in the requirement channel when the
// tag is actually used — bare `Database` (the instance type) is unbranded.
const dbLoad = Database.pipe(Effect.map((db) => db.q()));
type DatabaseReq = CtxOf<typeof dbLoad>;

// A plain (non-server) service that may legitimately appear in client R.
interface ClientService {
  readonly _tag: "ClientService";
}

declare const product: ProductShape;
declare const staticNode: Node<never, never>;
declare const clientNode: Node<never, ClientService>;
declare const dbNode: Node<never, DatabaseReq>;

// ── RServer is discharged: absent from output R ───────────────────────────────

const _discharged = Boundary.server(
  { load: () => Database.pipe(Effect.map((db) => db.q())), provide: DatabaseLive, schema: Product },
  (_p) => staticNode,
);
type _TDischarged = Expect<Equal<typeof _discharged, Node<never, never>>>;

// ── ELoad stays in the output error channel ───────────────────────────────────

const _loadError = Boundary.server(
  {
    load: () => Effect.fail(new FooError({ msg: "x" })),
    provide: Layer.empty,
    schema: Product,
  },
  (_p) => staticNode,
);
type _TLoadError = Expect<Equal<typeof _loadError, Node<FooError, never>>>;

// ── render's R passes through untouched (no Exclude) ──────────────────────────

const _clientR = Boundary.server(
  { load: () => Effect.succeed(product), provide: Layer.empty, schema: Product },
  (_p) => clientNode,
);
type _TClientR = Expect<Equal<typeof _clientR, Node<never, ClientService>>>;

// A server-branded tag leaking into `render` is preserved in R (NOT erased),
// so `hydrate` can later reject it via AssertNoServerOnly.
const _leak = Boundary.server(
  { load: () => Effect.succeed(product), provide: Layer.empty, schema: Product },
  (_p) => dbNode,
);
type _TLeak = Expect<Equal<Node.Context<typeof _leak>, DatabaseReq>>;

// ── AssertNoServerOnly: passes clean R, rejects leaked server tags ────────────

type _TPassThrough = Expect<Equal<AssertNoServerOnly<ClientService>, ClientService>>;
type _TPassEmpty = Expect<Equal<AssertNoServerOnly<never>, never>>;
// A leaked server tag does NOT pass through unchanged (resolves to the sentinel).
type _TReject = Expect<
  Equal<AssertNoServerOnly<DatabaseReq>, DatabaseReq> extends true ? false : true
>;

// ── provide is required ───────────────────────────────────────────────────────

// @ts-expect-error — `provide` is required even when RServer is never
Boundary.server({ load: () => Effect.succeed(product), schema: Product }, (_p) => staticNode);

// `load` needs Database but `provide` (Layer.empty) does not supply it
// @ts-expect-error — un-discharged server requirement
Boundary.server({ load: () => dbLoad, provide: Layer.empty, schema: Product }, (_p) => staticNode);
