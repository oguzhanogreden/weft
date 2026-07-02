/**
 * Type tests for `renderHast`: it accepts a `HastNode` and returns `Renderable[]`.
 */

import type { Renderable } from "@weftui/core";
import type { HastNode } from "../markdown-loader";
import { renderHast } from "../render-hast";

declare const node: HastNode;

// Should compile — accepts a HastNode, returns Renderable[].
const _result: Renderable[] = renderHast(node);
void _result;

// @ts-expect-error - the argument must be a HastNode, not a bare string.
renderHast("not a node");
