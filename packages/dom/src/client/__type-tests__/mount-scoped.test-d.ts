// oxlint-disable no-unused-vars
// Pins the scope-aware `mountScoped` / `hydrateScoped` signatures:
//  - both require an ambient `Scope.Scope` in `R` (direct `runPromise` is a
//    compile error; wrapping in `Effect.scoped` discharges it),
//  - the success value is `MountHandle`,
//  - `mountScoped`'s error union excludes `HydrationMismatchError` while
//    `hydrateScoped`'s includes it,
//  - `hydrateScoped` keeps `hydrate`'s server-only leak guard (a leaked
//    `ServerTag` degrades the return type to the `ServerOnlyLeak` sentinel).
// Checked by `vp run check` (the package tsconfig includes `src`). See
// `hydrate.test-d.ts` for the plain-`hydrate` counterpart.
import { Boundary, ServerTag, h, type Node } from "@weftui/core";
import { Rpc } from "effect/unstable/rpc";
import { Effect, Schema } from "effect";
import type { Scope } from "effect";
import type { HydrationMismatchError } from "~/data";
import type { MountHandle } from "../render";
import { hydrateScoped, mountScoped } from "../mount-scoped";

// ── Type helpers ──────────────────────────────────────────────────────────────

type CtxOf<T> = [T] extends [Effect.Effect<any, any, infer R>] ? R : never;
type ErrOf<T> = [T] extends [Effect.Effect<any, infer E, any>] ? E : never;
type OkOf<T> = [T] extends [Effect.Effect<infer A, any, any>] ? A : never;

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface ProductShape {
  readonly name: string;
}
const StockKey = Schema.Struct({ id: Schema.Number });
const Product = Schema.Struct({ name: Schema.String });
const GetProduct = Rpc.make("GetProduct", { payload: StockKey, success: Product });

class Database extends ServerTag("Database")<Database, { readonly q: () => ProductShape }>() {}

interface ClientService {
  readonly _tag: "ClientService";
}

declare const root: HTMLElement;
declare const clientNode: Node<never, ClientService>;
declare const dbNode: Node<never, CtxOf<typeof dbLoad>>;
const dbLoad = Database.pipe(Effect.map((db) => db.q()));

// ── AC-S1: mountScoped requires Scope.Scope, yields MountHandle ────────────────

const mResult = mountScoped(h.div({}, "ok"), root);

// Scope.Scope is in the requirement channel.
const _mNeedsScope: [Scope.Scope] extends [CtxOf<typeof mResult>] ? true : false = true;

// Success value is MountHandle.
const _mHandle: [OkOf<typeof mResult>] extends [MountHandle] ? true : false = true;

// @ts-expect-error — Scope.Scope unsatisfied: cannot run directly with runPromise
void Effect.runPromise(mResult);

// Wrapping in Effect.scoped discharges Scope.Scope — runnable.
void Effect.runPromise(Effect.scoped(mResult));

// ── Error unions: mountScoped excludes, hydrateScoped includes HydrationMismatch ─

const hResult = hydrateScoped(h.div({}, "ok"), root);

const _mNoHydrateErr: [HydrationMismatchError] extends [ErrOf<typeof mResult>] ? true : false =
  false;
const _hHasHydrateErr: [HydrationMismatchError] extends [ErrOf<typeof hResult>] ? true : false =
  true;

// ── AC-S7: hydrateScoped requires Scope.Scope ─────────────────────────────────

// @ts-expect-error — Scope.Scope unsatisfied for hydrateScoped too
void Effect.runPromise(hResult);

void Effect.runPromise(Effect.scoped(hResult));

// ── AC-S7: hydrateScoped keeps the server-only leak guard ─────────────────────

// A clean (non-server) client requirement is allowed: hydrateScoped returns a
// real Effect (not the ServerOnlyLeak sentinel).
const clientResult = hydrateScoped(clientNode, root);
const _clientAllowed: [typeof clientResult] extends [Effect.Effect<any, any, any>] ? true : false =
  true;

// A server boundary with a clean render leaves R server-tag-free — runnable.
const discharged = Boundary.rpc(
  GetProduct,
  () => ({ id: 1 }),
  () => h.div({}, "ok"),
);
void Effect.runPromise(Effect.scoped(hydrateScoped(discharged, root)));

// Back-compat: a raw Renderable string still hydrates in a scoped region.
void Effect.runPromise(Effect.scoped(hydrateScoped("text", root)));

// `dbNode`'s R carries the server-only Database brand: return type degrades to
// the ServerOnlyLeak sentinel — not an Effect, so Effect.scoped rejects it even
// though the Scope requirement would otherwise be satisfiable.
// @ts-expect-error — server-only Tag leaked into the client requirement channel R
void Effect.runPromise(Effect.scoped(hydrateScoped(dbNode, root)));

// Same leak surfaced through a Boundary.rpc whose render references the tag.
const leaky = Boundary.rpc(
  GetProduct,
  () => ({ id: 1 }),
  (_r) => dbNode,
);
// @ts-expect-error — server-only Tag leaked into the client requirement channel R
void Effect.runPromise(Effect.scoped(hydrateScoped(leaky, root)));
