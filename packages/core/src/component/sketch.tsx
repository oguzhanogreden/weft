/** @jsxImportSource .. */

import { Effect } from "effect";
import { Component } from "./component";
import type { JSXNode } from "~/types";

// oxlint-disable-next-line no-unused-vars
const MyComponent = Component.gen<{ name: string; children: JSXNode }>(function* (props) {
  const name = yield* Effect.orElse(props.name.get, () => Effect.succeed("No name provided"));
  return <div class={name}>{props.children}</div>;
});
