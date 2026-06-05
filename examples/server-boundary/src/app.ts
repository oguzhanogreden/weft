/**
 * The shared isomorphic App for the `Boundary.server` example.
 *
 * A product page whose data lives behind a **server-only** `Database` service.
 * The page is wrapped in a `Boundary.server`: on the server the boundary runs
 * `load` (reading `Database`, supplied via `provide`), serializes the product
 * inline as `<script type="application/json">`, and renders `render(product)` to
 * HTML. In the browser `hydrate` **replays** that payload — it decodes the inline
 * JSON and re-runs `render(product)` against the adopted DOM, but **never runs
 * `load`** and never touches `Database`.
 *
 * That guarantee shows up two ways:
 *   - **Structurally:** `App()` has requirement channel `never` — `Database` is
 *     discharged by `provide` inside the boundary, so the client `hydrate` call
 *     compiles and runs without ever providing the server-only service.
 *   - **Observably:** {@link getDatabaseReads} counts how often the server-only
 *     `Database` is read; it advances during server render and stays put across
 *     client hydration (asserted by the e2e test).
 *
 * The `render(product)` subtree also owns a reactive `qty` `SubscriptionRef`,
 * proving a `Boundary.server` composes with the flash-free reactive-region
 * hydration the renderer already does: the server's first emission (`1`) matches
 * the client's, so the quantity node is adopted in place — no flicker — and the
 * +/- buttons work once hydrated.
 */

import { Boundary, ServerTag, h } from "@effect-ui/core";
import { Effect, Layer, Schema, SubscriptionRef } from "effect";

/** The product shape stored in the (mock) database and rendered on the page. */
export interface ProductShape {
  readonly name: string;
  readonly price: number;
  readonly blurb: string;
}

/**
 * A server-only data source. Branded via {@link ServerTag}, so referencing it in
 * universal `render` code (or leaking it to `hydrate`) is a compile error; it is
 * discharged on the server by the boundary's required `provide`.
 */
export class Database extends ServerTag("Database")<
  Database,
  { readonly getProduct: () => Effect.Effect<ProductShape> }
>() {}

const PRODUCT: ProductShape = {
  name: "Effect Mug",
  price: 18,
  blurb: "Holds 350ml of strongly-typed coffee. Dishwasher- and exception-safe.",
};

let databaseReads = 0;

/**
 * How many times the server-only {@link Database} has been read. The e2e test
 * snapshots this after the server render and asserts it does not advance across
 * client hydration — direct evidence the client replays the payload instead of
 * re-running `load`.
 */
export const getDatabaseReads = (): number => databaseReads;

/**
 * Live {@link Database}, provided **only** on the server through the boundary's
 * `provide`. Each read bumps {@link getDatabaseReads}.
 */
export const DatabaseLive = Layer.succeed(Database, {
  getProduct: () =>
    Effect.sync(() => {
      databaseReads += 1;
      return PRODUCT;
    }),
});

/** Wire contract for {@link ProductShape}: encoded to JSON on the server, decoded on the client. */
const Product = Schema.Struct({
  name: Schema.String,
  price: Schema.Number,
  blurb: Schema.String,
});

/**
 * Typed `load` failure for {@link FailingApp}. Being a `Schema.TaggedError`, it
 * doubles as the boundary's `failure` wire contract: encoded on the server into
 * the inline failure payload and decoded + re-raised on the client during
 * `hydrate`.
 */
export class ProductLoadError extends Schema.TaggedError<ProductLoadError>()("ProductLoadError", {
  reason: Schema.String,
}) {}

let failingLoadAttempts = 0;

/**
 * How many times {@link FailingApp}'s `load` has been *attempted*. The failure
 * e2e test snapshots this after the server render and asserts it does not advance
 * across client hydration — direct evidence the client replays the encoded
 * failure instead of re-running `load`.
 */
export const getFailingLoadAttempts = (): number => failingLoadAttempts;

/**
 * Root component. A single `Boundary.server` that loads the product from the
 * server-only `Database` and renders it with a client-interactive quantity
 * control. Requires no services — `Database` is discharged inside the boundary.
 */
export const App = () =>
  Boundary.server(
    {
      load: () => Effect.flatMap(Database, (db) => db.getProduct()),
      provide: DatabaseLive,
      schema: Product,
    },
    (product) =>
      Effect.gen(function* () {
        const qty = yield* SubscriptionRef.make(1);
        const increment = () => SubscriptionRef.update(qty, (n) => n + 1);
        const decrement = () => SubscriptionRef.update(qty, (n) => Math.max(1, n - 1));

        return yield* h.div({ class: "product" }, [
          h.h1(product.name),
          h.p({ class: "blurb" }, product.blurb),
          h.p({ class: "price" }, `$${product.price}`),
          h.div({ class: "qty" }, [
            h.button({ type: "button", onclick: () => decrement() }, "-"),
            h.span({ id: "qty" }, [qty.changes]),
            h.button({ type: "button", onclick: () => increment() }, "+"),
          ]),
          h.div([h.span({ class: "status", id: "status" }, "[SSR — not yet interactive]")]),
        ]);
      }),
  );

/**
 * Failure-replay variant. The same server-only `load`, but it **fails** with a
 * typed {@link ProductLoadError}. On the server the error propagates to the
 * enclosing `Boundary.catchAll`, which renders the `.load-error` fallback and
 * emits an inline `data-eui-boundary-failure` payload (the encoded error +
 * boundary index). On the client `hydrate` decodes that payload and re-raises the
 * **same** typed error into the **same** `catchAll`, reproducing the identical
 * fallback DOM — flash-free and **without ever re-running `load`** (replay, never
 * retry). {@link getFailingLoadAttempts} proves `load` never runs on the client.
 */
export const FailingApp = () =>
  Boundary.catchAll(
    {
      fallback: (error: ProductLoadError) =>
        h.div({ class: "load-error" }, [
          h.h1("Out of stock"),
          h.p({ class: "reason" }, error.reason),
        ]),
    },
    [
      Boundary.server(
        {
          load: () =>
            Effect.sync(() => {
              failingLoadAttempts += 1;
            }).pipe(
              Effect.flatMap(() =>
                Effect.fail(new ProductLoadError({ reason: "inventory service unavailable" })),
              ),
            ),
          provide: Layer.empty,
          schema: Product,
          failure: ProductLoadError,
        },
        (product) => h.div({ class: "product" }, product.name),
      ),
    ],
  );
