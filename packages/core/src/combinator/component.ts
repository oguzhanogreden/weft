import type { Node, PropsE, PropsR } from "./types";

/**
 * Factory for custom components that preserves E/R propagation from caller props.
 * The returned function is generic over `P extends BaseProps` — TypeScript infers
 * the caller's specific reactive prop values and extracts E/R from them automatically.
 */
export function defineComponent<BaseProps, CompE, CompR>(
  render: (props: BaseProps) => Node<CompE, CompR>,
): <P extends BaseProps>(props: P) => Node<PropsE<P> | CompE, PropsR<P> | CompR> {
  return render;
}
