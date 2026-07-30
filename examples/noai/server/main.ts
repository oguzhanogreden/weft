/**
 * Server entry. Thin and side-effectful, for the same reason `src/main.ts` is:
 * `server/server.ts` exports `renderPage`, and its node test imports that. A
 * top-level `main()` there would start a listener during `vp run test`.
 *
 * Run with `vp run dev`.
 */

import { Effect } from "effect";
import { main } from "./server";

void Effect.runPromise(main());
