/**
 * Document shell factory.
 *
 * Builds `<html>/<head>/<body>` with the `#root` mount point and the client entry
 * `<script>`, splicing the app via `yield* Router.Outlet` (injected per request by
 * `RouterServer`). The client entry `src` differs between dev and prod — dev points
 * at the raw `/src/entry-client.ts` Vite serves, prod at the hashed build artifact
 * resolved from the manifest — so it is a parameter rather than hardcoded.
 */

import { Component, h } from "@weftui/core";
import { Router } from "@weftui/router";

/** Builds the document shell `component` thunk for a given client entry `src`. */
export const documentShell = (clientEntry: string) =>
  Component.gen(function* () {
    const outlet = yield* Router.Outlet;
    return yield* h.html({ lang: "en" }, [
      h.head([
        h.meta({ charset: "utf-8" }),
        h.meta({ name: "viewport", content: "width=device-width, initial-scale=1" }),
        h.title("Weft"),
      ]),
      h.body([h.main({ id: "root" }, [outlet]), h.script({ type: "module", src: clientEntry })]),
    ]);
  });
