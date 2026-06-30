/**
 * The build-time-backed `Docs` value.
 *
 * Isolated in its own module because it imports the `virtual:weft-docs` module the
 * loader plugin emits — kept out of `docs-service.ts` so that module (and the fixture
 * `makeDocs`) stays importable under the node test runner. Provided into the render
 * tree at the app entries (`entry-server.ts` document shell, `entry-client.ts`
 * hydrate); tests build a fixture value with `makeDocs` instead.
 */

import { getAllDocs } from "virtual:weft-docs";
import { type DocsService, makeDocs } from "./docs-service";

/** The documentation model baked at build time. */
export const liveDocs: DocsService = makeDocs(getAllDocs());
