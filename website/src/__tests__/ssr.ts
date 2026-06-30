/**
 * Shared SSR test helper.
 *
 * `renderToString` from `@weftui/dom/server` requires an `AppRpcClientTag` in context
 * unconditionally, even for trees with no `Boundary.rpc`. `renderString` discharges
 * that with a no-op layer that dies if the client is ever actually called, so a
 * boundary-free component can be rendered to an HTML string in a node test.
 */

import { AppRpcClientTag } from "@weftui/core";
import type { AppRpcClient, Renderable } from "@weftui/core";
import { renderToString } from "@weftui/dom/server";
import { Effect, Layer } from "effect";

/** No-op rpc client layer for boundary-free SSR tests. */
const NoRpc: Layer.Layer<AppRpcClientTag> = Layer.succeed(AppRpcClientTag, {
  call: () => Effect.die(new Error("AppRpcClient.call invoked in a no-rpc test")),
} satisfies AppRpcClient);

/** Renders a boundary-free node to its server HTML string. */
export function renderString(node: Renderable): Promise<string> {
  return Effect.runPromise(Effect.provide(renderToString(node), NoRpc));
}
