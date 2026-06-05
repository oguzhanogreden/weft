import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import type { RouterDef } from "../compile";

/**
 * Generates a flat `HttpApi` from a compiled route tree (S4): a single `"pages"`
 * group whose endpoints are GET endpoints — one per leaf — at each leaf's full
 * path pattern, carrying `setPath(pathSchema)`, `setUrlParams(querySchema)`, and a
 * text/HTML success. The tree (not `HttpApi`) is the authoring surface; this is
 * the compilation target that drives an `HttpApiBuilder` server and a future
 * derived `HttpApiClient`.
 */
export function toHttpApi(def: RouterDef): HttpApi.HttpApi.Any {
  // The group/endpoint types accumulate per-endpoint; a precise static type is
  // not expressible across a runtime loop, so the assembly is intentionally loose.
  const group = def.compiled.leaves.reduce(
    // oxlint-disable-next-line typescript/no-explicit-any
    (g: any, leaf) =>
      g.add(
        HttpApiEndpoint.get(leaf.id, leaf.fullPathPattern as `/${string}`)
          // Path/UrlParams schemas are string-encodeable at runtime (param schemas
          // round-trip strings); the generic `Record` type doesn't carry platform's
          // string-encodeable brand, so the calls are cast.
          // oxlint-disable-next-line typescript/no-explicit-any
          .setPath(leaf.pathSchema as any)
          // oxlint-disable-next-line typescript/no-explicit-any
          .setUrlParams(leaf.querySchema as any)
          .addSuccess(Schema.String),
      ),
    HttpApiGroup.make("pages"),
  );
  return HttpApi.make("router").add(group);
}
