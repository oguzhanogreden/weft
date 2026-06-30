/**
 * Ambient type for the build-time `virtual:weft-docs` module emitted by the
 * `weftDocs` Vite plugin (`src/lib/docs-plugin.ts`). Lets `nav.ts`, `routes/docs.ts`,
 * and `routes/api.ts` import the baked doc model as typed, pure data.
 */
declare module "virtual:weft-docs" {
  import type { DocModel } from "~/lib/markdown-loader";

  export const getAllDocs: () => DocModel[];
  export const getDoc: (category: string, slug: string) => DocModel | undefined;
}
