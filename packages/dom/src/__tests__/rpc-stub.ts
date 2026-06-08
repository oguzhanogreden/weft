import { AppRpcClientTag } from "@effect-ui/core";
import type { AppRpcClient } from "@effect-ui/core";
import { Effect, Layer } from "effect";

/**
 * A no-op {@link AppRpcClientTag} layer for SSR/hydrate tests whose tree contains
 * **no** `Boundary.rpc` (and therefore never calls the client). The render
 * functions require an `AppRpcClientTag` in context unconditionally; this discharges
 * that requirement with a `call` that dies if it is ever actually invoked, so a
 * boundary-free render type-checks and runs without a real rpc client.
 */
export const NoRpc: Layer.Layer<AppRpcClientTag> = Layer.succeed(AppRpcClientTag, {
  call: () => Effect.die(new Error("AppRpcClient.call invoked in a no-rpc test")),
} satisfies AppRpcClient);
