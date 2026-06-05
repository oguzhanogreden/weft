# @effect-ui/router API Reference

Universal nested router for effect-ui. See the [Routing guide](../guides/routing.md) for a narrative walkthrough.

Three entry points mirror `@effect-ui/dom`:

| Import                     | Use                                                                         |
| -------------------------- | --------------------------------------------------------------------------- |
| `@effect-ui/router`        | Shared authoring + universal nodes (`Router`, `href`, `RouterApp`, errors). |
| `@effect-ui/router/client` | Client runtime (`RouterLive`, plus re-exported `RouterApp` / `Router`).     |
| `@effect-ui/router/server` | Server rendering (`RouterServer`, `toHttpApi`).                             |

## `Router`

`Router` is both an Effect `Context.Tag` and the authoring namespace; the two roles merge by declaration. `yield* Router` reads the per-render service; `Router.route(…)` authors a tree.

The service value carries:

- **`currentMatch`** — the current match as a hot `Subscribable<RouteMatch>`; drives the outlet.
- **`navigate(to)`** — navigates to a path (with optional query). On the client this pushes History state and re-renders the affected outlet; on the server it is a no-op.

### `Router.route`

```typescript
Router.route<Path, Query, S>(
  segment: string,
  config: { path?: Path; query?: Query; component: S },
): RouteNode<Path, Query, E, R>;
```

Declares a leaf page. `segment` is relative to the parent and may contain `:name` placeholders. `component` is a [`ComponentSlot`](#componentslot) — its `E`/`R` channels are recovered and propagate up the tree. The returned `RouteNode` is also the reference passed to [`href`](#href).

```typescript
const userRoute = Router.route("users/:id", {
  path: { id: Schema.NumberFromString },
  component: Component.gen(function* () {
    const { id } = yield* Router.params({ id: Schema.NumberFromString });
    return yield* h.div(`User ${id}`);
  }),
});
```

### `Router.layout`

```typescript
Router.layout<C, S>(config: { component: S }, children: C): LayoutNode<E, R>;
```

Declares a layout — purely UI nesting, owning **no path or segment**. `component` splices the injected outlet via `yield* Router.Outlet`. `Router.Outlet` is excluded from the layout's aggregate requirement channel (the router discharges it per render); the subtree's real channels are unioned in.

### `Router.router`

```typescript
Router.router<T, NF>(root: T, options: { notFound: () => NF }): RouterDef<E, R>;
```

Seals a route tree into a [`RouterDef`](#routerdef), compiling it eagerly (so leaf references are stamped for `href`) and capturing the app-level not-found page. The tree's aggregate channels (plus the not-found page's) ride on the returned `RouterDef`'s phantom `E`/`R`.

### `Router.Outlet`

A `Context.Tag` whose value is the node to splice for the next level down. A layout (or the server document shell) reads it with `const outlet = yield* Router.Outlet`. Typed **opaque** as `Node<never, never>`, and discharged by the router at render time, so it never appears in a reader's aggregate requirement channel.

### `Router.params` / `Router.query`

```typescript
Router.params<F extends Fields>(fields: F): Effect<FieldsType<F>, RouterParamsError, Router>;
Router.query<F extends Fields>(fields: F): Effect<FieldsType<F>, RouterParamsError, Router>;
```

Validating accessors that read the **live match** (`currentMatch.get`), pick the requested `fields` keys from the decoded path/query, and validate them against the `Type` side of `Schema.Struct(fields)`. Readable from **any** component, not just the leaf. They fail with a [`RouterParamsError`](#routerparamserror) (`source: "path" | "query"`, plus the requested `keys`) when no route matches or a key is missing/invalid.

## `href`

```typescript
href<Path, Query>(ref: RouteNode<Path, Query>, args?: HrefArgs<Path, Query>): string;
```

Builds a type-safe URL for a leaf route reference. Path params encode into the pattern; query values encode through the query schema into a key-sorted search string. Round-trips with the matcher.

- `path` is **required** when its decoded type has required keys; `query` is optional when every query field is optional (`HrefArgs`).
- Throws if the leaf belongs to a tree that has not been sealed with `Router.router()`.

```typescript
href(userRoute, { path: { id: 42 } }); // "/users/42"
href(postsRoute, { path: { id: 1 }, query: { sort: "new" } }); // "/users/1/posts?sort=new"
```

## Universal nodes

### `RouterApp`

```typescript
RouterApp<E, R>(def: RouterDef<E, R>, options?: RouterAppOptions): Node<Exclude<E, RouterNotFound>, R | Router>;
```

The universal router root node — render this on both server and client. Wraps the nested outlet in the router's internal not-found boundary, so a `RouterNotFound` raised by a page renders the configured `notFound` page in place. The optional `onNotFound` callback (`RouterAppOptions`) lets the server report a page-raised 404 without changing the rendered structure (the client omits it).

`RouterApp` requires `Router` in its environment — provide it via `RouterLive` (client) or `RouterServer` (server), not `Effect.provide` at the node level (that would release the scoped layer immediately).

### `outletNode` (a.k.a. `RouterOutlet`)

```typescript
outletNode<E, R>(def: RouterDef<E, R>): Node<E | RouterNotFound, R | Router>;
```

The bare nested-outlet node without the internal not-found boundary — for callers placing their own not-found handling. Re-exported from `@effect-ui/router/client` as `RouterOutlet`.

## Client — `@effect-ui/router/client`

### `RouterLive`

```typescript
RouterLive(def: RouterDef): Layer.Layer<Router>;
```

The client `Router` layer, backed by the History API. Seeds a `SubscriptionRef` from `window.location`, listens for `popstate`, and installs the same-origin link-click interceptor. **Scoped** — it must outlive the mount, so provide it through a `ManagedRuntime`:

```typescript
const runtime = ManagedRuntime.make(RouterLive(App));
void runtime.runPromise(hydrate(RouterApp(App), root));
```

### `installLinkInterceptor`

```typescript
installLinkInterceptor(compiled: Compiled, navigate: (to: string) => Effect<void>): Effect<void, never, Scope>;
```

The delegated click interceptor `RouterLive` installs for you. Exposed for advanced/manual wiring. Intercepts plain same-origin clicks whose href resolves to a route; leaves modified clicks, `target=_blank`, `download`, external origins, same-document navigations, and non-matching hrefs to the browser.

## Server — `@effect-ui/router/server`

### `RouterServer`

A namespace for server-side rendering of a `RouterDef`.

```typescript
RouterServer.render(def, options: { document; url }): Effect<{ html; status }, Error>;
RouterServer.toWebHandler(def, options: { document }): (request: Request) => Promise<Response>;
```

- **`render`** matches `url`, builds a fixed-match server `Router`, injects `RouterApp(def)` into the `document` shell via `Router.Outlet`, and renders via `renderToStringHydratable` — returning `{ html, status }` with `<!DOCTYPE html>` prepended. `status` is `404` when no route matches or a page raises `RouterNotFound`.
- **`toWebHandler`** wraps `render` as a Web `fetch`-style handler returning a `text/html` `Response` (500 on error).
- **`document`** is a [`ComponentSlot`](#componentslot) that splices the app via `yield* Router.Outlet`; `render` provides both `Router.Outlet` and `Router`.

### `toHttpApi`

```typescript
toHttpApi(def: RouterDef): HttpApi.HttpApi.Any;
```

Generates a flat `HttpApi` from the compiled tree: one `"pages"` group with a GET endpoint per leaf at its full path pattern, carrying `setPath(pathSchema)`, `setUrlParams(querySchema)`, and a text/HTML success. The compilation target for an `HttpApiBuilder` server or a derived `HttpApiClient`.

## Errors

### `RouterNotFound`

`Schema.TaggedError` with an optional `path: string`. Raised by [`notFound`](#notfound) or when no route matches. Caught by the router's internal not-found boundary; export it to place your own `Boundary.catchTag("RouterNotFound", …)` (a nearer user boundary wins).

### `RouterParamsError`

`Schema.TaggedError` with `source: "path" | "query"` and `keys: readonly string[]`. Raised by `Router.params` / `Router.query` when the live match doesn't satisfy the requested fields. Bubbles into the tree's aggregate error channel.

### `notFound`

```typescript
notFound(path?: string): Effect<never, RouterNotFound>;
```

Short-circuits the current page render with a `RouterNotFound`. Callable from any page or layout `component`; the server responds with HTTP 404.

### `isRouterNotFound`

```typescript
isRouterNotFound(u: unknown): u is RouterNotFound;
```

Type guard recognising a `RouterNotFound` value regardless of its prototype.

## Compilation & matching (advanced)

These power the runtime and are exported for tooling/tests; most apps never touch them directly.

| Export                      | Description                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `compile(def)`              | Walks a tree into flat `CompiledLeaf`s with merged path/query schemas and layout chains. |
| `leafRegistry`              | `WeakMap<RouteNode, CompiledLeaf>` read by `href` to resolve a leaf's pattern/schemas.   |
| `match(compiled, url)`      | Resolves a URL to a `RouteMatch` (`Matched` with decoded `path`/`query`, or `NotFound`). |
| `compileMatchers(compiled)` | Precompiles per-leaf regex matchers.                                                     |

## Types

| Type                                                             | Description                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `RouterDef<E, R>`                                                | A sealed, compiled router. The unit passed to client and server; phantom `E`/`R` carry the tree's aggregate channels.       |
| `RouteNode<Path, Query, E, R>` / `LayoutNode<E, R>` / `TreeNode` | Authored tree nodes.                                                                                                        |
| `ComponentSlot<N>`                                               | A `(props: any) => N` callable producing a `Node`; accepts a plain thunk or a `Component.make` / `Component.gen` component. |
| `RouteMatch`                                                     | `{ _tag: "Matched"; leaf; path; query; url }` or `{ _tag: "NotFound"; url }`.                                               |
| `HrefArgs<Path, Query>`                                          | The `href` argument object; `path`/`query` become optional when their decoded type has no required keys.                    |
| `Fields` / `FieldsType<F>`                                       | `Schema.Struct.Fields` and the `Type` side of its `Schema.Struct`.                                                          |
| `Compiled` / `CompiledLeaf` / `CompiledLayout`                   | The compiled tree shapes.                                                                                                   |
| `RouterOptions` / `RouterAppOptions`                             | Options for `Router.router` (`notFound`) and `RouterApp` (`onNotFound`).                                                    |
