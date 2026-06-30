/**
 * Demo block component.
 *
 * Renders a **live demo**: a preview pane that mounts the real Weft component from
 * the demo registry, above a code pane (the shared `CodeBlock`). Produced by
 * `render-hast` when a fenced code block carries `demo=<id>`.
 *
 * The preview is an ordinary subtree of the page — SSR-rendered and hydrated with
 * everything else, no separate mount. An unknown `id` degrades to a visible inline
 * warning plus the code pane rather than throwing, so a typo in `demo=` never breaks
 * the build or the page.
 */

import { Component, h } from "@weftui/core";
import type { Renderable } from "@weftui/core";
import { getDemo } from "../demos/index";
import { CodeBlock } from "./code-block";

export type DemoProps = {
  /** Registry id, from the markdown `demo=<id>` marker. */
  readonly id: string;
  /** Pre-highlighted code children for the code pane. */
  readonly tokens: readonly Renderable[];
  /** Optional language label. */
  readonly lang?: string;
  /** Raw source for the code pane's copy button. */
  readonly raw: string;
};

/**
 * A live demo: preview pane (the registry component) over a code pane.
 *
 * @param props.id registry id; unknown ids render a warning instead of a preview
 */
export const Demo = Component.gen(function* (props: DemoProps) {
  const factory = getDemo(props.id);

  const preview =
    factory === undefined
      ? h.div({ class: "demo-block__warning", role: "alert" }, `Unknown demo: "${props.id}"`)
      : h.div({ class: "demo-block__preview" }, [factory()]);

  return yield* h.div({ class: "demo-block" }, [
    preview,
    h.div({ class: "demo-block__code" }, [
      CodeBlock({ tokens: props.tokens, lang: props.lang, raw: props.raw }),
    ]),
  ]);
});
