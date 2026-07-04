import { Registry } from "@effect-atom/atom";
import { mount } from "@weftui/dom/client";
import { Effect } from "effect";
import { App } from "./app";

// The registry must outlive the mount effect: atom subscriptions are forked
// fibers that read it for the app's whole lifetime. `Registry.layer` is scoped
// and would dispose the registry as soon as `mount` resolves, so provide a
// manually created registry as a plain service value instead.
const registry = Registry.make();

void Effect.runPromise(
  mount(App(), document.getElementById("root")!).pipe(
    Effect.provideService(Registry.AtomRegistry, registry),
  ),
);
