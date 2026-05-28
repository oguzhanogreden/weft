import { Effect } from "effect";
import type { DOMNode, Node, PropsE, PropsR } from "./types";
import type { YieldWrap } from "effect/Utils";

export namespace Component {
  /**
   * Factory for generator components that preserves E/R propagation from caller props.
   * The returned function is generic over `P extends BaseProps` — TypeScript infers
   * the caller's specific reactive prop values and extracts E/R from them automatically.
   */
  export function gen<
    Eff extends YieldWrap<Effect.Effect<any, any, any>>,
    BaseProps = Record<string, never>,
  >(
    f: (props: BaseProps) => Generator<Eff, DOMNode, never>,
  ): <P extends BaseProps>(
    props: P,
  ) => Node<
    PropsE<P> | (Eff extends YieldWrap<Effect.Effect<any, infer E, any>> ? E : never),
    PropsR<P> | (Eff extends YieldWrap<Effect.Effect<any, any, infer R>> ? R : never)
  > {
    return (props) =>
      Effect.gen(function* () {
        return yield* f(props) as any;
      }) as any;
  }

  export function make<Eff extends Effect.Effect<any, any, any>, BaseProps = Record<string, never>>(
    f: (props: BaseProps) => Eff,
  ): <P extends BaseProps>(
    props: P,
  ) => Node<
    PropsE<P> | (Eff extends Effect.Effect<any, infer E, any> ? E : never),
    PropsR<P> | (Eff extends Effect.Effect<any, any, infer R> ? R : never)
  > {
    return f;
  }
}
