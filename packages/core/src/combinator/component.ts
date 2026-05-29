import { Effect } from "effect";
import type { Child, ChildrenE, ChildrenR, DOMNode, Node, PropsE, PropsR } from "./types";
import type { YieldWrap } from "effect/Utils";

// TODO: props + children signature
// TODO: jsdocs on `make`
// TODO: documentation
export namespace Component {
  export type Children<Input = never> = readonly Child[] | ((input: Input) => readonly Child[]);

  export type Component<P, C extends Children, E, R> = <GenP extends P, GenC extends C>(
    props: GenP,
    children?: GenC,
  ) => Node<
    PropsE<GenP> | ChildrenE<GenC extends (...args: any[]) => any ? ReturnType<GenC> : GenC> | E,
    PropsR<GenP> | ChildrenR<GenC extends (...args: any[]) => any ? ReturnType<GenC> : GenC> | R
  >;

  /**
   * Factory for generator components that preserves E/R propagation from caller props.
   * The returned function is generic over `P extends BaseProps` — TypeScript infers
   * the caller's specific reactive prop values and extracts E/R from them automatically.
   */
  export function gen<
    Eff extends YieldWrap<Effect.Effect<any, any, any>>,
    BaseProps = Record<string, never>,
    C extends Children = readonly Child[],
  >(
    f: (props: BaseProps, children: C) => Generator<Eff, DOMNode, never>,
  ): Component.Component<
    BaseProps,
    C,
    Eff extends YieldWrap<Effect.Effect<any, infer E, any>> ? E : never,
    Eff extends YieldWrap<Effect.Effect<any, any, infer R>> ? R : never
  > {
    return (props: any, children: any = []) =>
      Effect.gen(function* () {
        return yield* f(props, children) as any;
      }) as any;
  }

  export function make<
    Eff extends Effect.Effect<any, any, any>,
    BaseProps = Record<string, never>,
    C extends Children = readonly Child[],
  >(
    f: (props: BaseProps, children: C) => Eff,
  ): Component<
    BaseProps,
    C,
    Eff extends Effect.Effect<any, infer E, any> ? E : never,
    Eff extends Effect.Effect<any, any, infer R> ? R : never
  > {
    return f as any;
  }
}
