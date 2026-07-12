import { mountScoped } from "@weftui/dom/client";
import { Effect } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { App } from "./app";

// Lifetime rule: the atom registry must outlive initial render — atom
// subscriptions are forked fibers that read it for the app's whole lifetime.
//
// `AtomRegistry.layer` is a *scoped* layer. Provide it OUTSIDE a long-lived scoped
// region so it lives until the region ends, not just until `mount` resolves.
// `mountScoped` registers `unmount` on the region's scope; `Effect.never` keeps
// the region (and therefore the registry) open for the app's lifetime. Drive it
// with `runFork` — `Effect.never` never settles, so `runPromise` would hang.
const program = Effect.scoped(
  Effect.gen(function* () {
    yield* mountScoped(App(), document.getElementById("root")!);
    yield* Effect.never;
  }),
).pipe(Effect.provide(AtomRegistry.layer));

Effect.runFork(program);
