import MagicString from "magic-string";

/**
 * The module specifier `Boundary` is imported from. Only `.server` calls on a
 * binding resolved to this module are eligible for pruning.
 */
const CORE_MODULE = "@effect-ui/core";

/** The `Boundary` member call this plugin rewrites. */
const SERVER_METHOD = "server";

/** Props stripped from the client build's `Boundary.server` first argument. */
const STRIPPED_KEYS = new Set(["load", "provide"]);

/**
 * Minimal structural view of an ESTree node. Both supported parsers (acorn on
 * Vite 7, Oxc on Vite 8) attach numeric `start`/`end` byte offsets per the
 * Rollup/Rolldown convention; we rely only on `type` + those offsets and walk
 * children generically, so no parser-specific node typings are needed.
 */
export interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** A `Boundary.server` call site that could not be safely pruned. */
export interface PruneWarning {
  /** Human-readable explanation, suitable for `this.warn`. */
  readonly message: string;
  /** Source offset of the offending call, for `this.warn`'s `pos`. */
  readonly pos: number;
}

/** Outcome of {@link pruneServerBoundaries} for a single module. */
export interface PruneResult {
  /** Whether any `load`/`provide` property was actually removed. */
  readonly changed: boolean;
  /** The rewritten source (equal to the input when `changed` is `false`). */
  readonly code: string;
  /** Source map for the edits, or `null` when nothing changed. */
  readonly map: ReturnType<MagicString["generateMap"]> | null;
  /** Non-fatal warnings for call sites that were skipped. */
  readonly warnings: ReadonlyArray<PruneWarning>;
}

/** Narrow an unknown property to a real AST node. */
function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}

/**
 * Resolve a property key to its static name, or `null` if dynamic. A string
 * `Literal` is static regardless of `computed` (`{ "load": x }` and
 * `{ ["load"]: x }` both name `load`). A bare `Identifier` is static **only when
 * not computed**: in a computed key `{ [load]: x }` the identifier is the
 * *variable* `load`, not the property name, and must never be treated as static.
 */
function staticKeyName(key: AstNode, computed: boolean): string | null {
  if (key.type === "Literal") {
    const value = key["value"];
    return typeof value === "string" ? value : null;
  }
  if (!computed && key.type === "Identifier") return key["name"] as string;
  return null;
}

/**
 * Collect the local names that `Boundary` is bound to via a named import from
 * `@effect-ui/core` (honouring aliases, `import { Boundary as B }`).
 */
function findBoundaryBindings(program: AstNode): Set<string> {
  const bindings = new Set<string>();
  const body = program["body"];
  if (!Array.isArray(body)) return bindings;
  for (const stmt of body as AstNode[]) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = stmt["source"] as AstNode | undefined;
    if (!source || source["value"] !== CORE_MODULE) continue;
    const specifiers = stmt["specifiers"];
    if (!Array.isArray(specifiers)) continue;
    for (const spec of specifiers as AstNode[]) {
      if (spec.type !== "ImportSpecifier") continue;
      const imported = spec["imported"] as AstNode | undefined;
      if (imported && imported.type === "Identifier" && imported["name"] === "Boundary") {
        const local = spec["local"] as AstNode | undefined;
        if (local && local.type === "Identifier") bindings.add(local["name"] as string);
      }
    }
  }
  return bindings;
}

/** Collect every identifier bound by a (possibly destructuring) pattern. */
function collectPatternNames(pattern: AstNode | null | undefined, out: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      out.add(pattern["name"] as string);
      break;
    case "ObjectPattern":
      for (const prop of (pattern["properties"] as AstNode[]) ?? []) {
        if (prop.type === "RestElement") collectPatternNames(prop["argument"] as AstNode, out);
        else collectPatternNames(prop["value"] as AstNode, out);
      }
      break;
    case "ArrayPattern":
      for (const el of (pattern["elements"] as (AstNode | null)[]) ?? [])
        collectPatternNames(el, out);
      break;
    case "AssignmentPattern":
      collectPatternNames(pattern["left"] as AstNode, out);
      break;
    case "RestElement":
      collectPatternNames(pattern["argument"] as AstNode, out);
      break;
    default:
      break;
  }
}

/**
 * Collect the names a function scope binds: its parameters plus all hoisted
 * declarations (var/let/const, function, class) in its body, **not** descending
 * into nested functions. This is a deliberate function-scoped over-approximation:
 * if a name is declared anywhere in the function we treat the outer `Boundary`
 * binding as shadowed throughout it. The bias is toward *not* pruning, which is
 * always safe (it only keeps the bundle larger, never breaks behaviour).
 */
function collectFunctionScope(fn: AstNode): Set<string> {
  const names = new Set<string>();
  for (const param of (fn["params"] as AstNode[]) ?? []) collectPatternNames(param, names);
  if (fn.type === "FunctionExpression") {
    const id = fn["id"] as AstNode | undefined;
    if (id && id.type === "Identifier") names.add(id["name"] as string);
  }
  const body = fn["body"] as AstNode | undefined;
  if (body && body.type === "BlockStatement") collectHoistedNames(body, names);
  return names;
}

/** Walk a block collecting declared names, stopping at nested function bodies. */
function collectHoistedNames(node: AstNode, out: Set<string>): void {
  const visit = (n: unknown): void => {
    if (!isNode(n)) return;
    switch (n.type) {
      case "FunctionDeclaration": {
        const id = n["id"] as AstNode | undefined;
        if (id && id.type === "Identifier") out.add(id["name"] as string);
        return; // do not descend into the nested function body
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return; // its own scope; handled when the walker enters it
      case "ClassDeclaration": {
        const id = n["id"] as AstNode | undefined;
        if (id && id.type === "Identifier") out.add(id["name"] as string);
        return;
      }
      case "VariableDeclaration":
        for (const decl of (n["declarations"] as AstNode[]) ?? [])
          collectPatternNames(decl["id"] as AstNode, out);
        return;
      default:
        break;
    }
    for (const key in n) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = (n as Record<string, unknown>)[key];
      if (Array.isArray(child)) for (const c of child) visit(c);
      else visit(child);
    }
  };
  visit(node);
}

/** Collect the lexical names declared *directly* by a list of statements. */
function collectLexicalBindings(statements: ReadonlyArray<AstNode>, out: Set<string>): void {
  for (const stmt of statements) {
    switch (stmt.type) {
      case "VariableDeclaration":
        for (const decl of (stmt["declarations"] as AstNode[]) ?? [])
          collectPatternNames(decl["id"] as AstNode, out);
        break;
      case "FunctionDeclaration":
      case "ClassDeclaration": {
        const id = stmt["id"] as AstNode | undefined;
        if (id && id.type === "Identifier") out.add(id["name"] as string);
        break;
      }
      default:
        break;
    }
  }
}

/** Collect the binding pattern names of a `for`/`for-in`/`for-of` head, if lexical. */
function collectForBindings(head: AstNode | undefined, out: Set<string>): void {
  if (head && head.type === "VariableDeclaration")
    for (const decl of (head["declarations"] as AstNode[]) ?? [])
      collectPatternNames(decl["id"] as AstNode, out);
}

/**
 * Names a **non-function** scope binds directly: the lexical declarations of a
 * block/switch, a `catch` clause's param, and the binding of a `for`/`for-in`/
 * `for-of` head. Does not descend into nested blocks or functions — each gets its
 * own scope as the walker reaches it. Like {@link collectFunctionScope} this is a
 * deliberate over-approximation (a name declared anywhere in the construct treats
 * the outer `Boundary` as shadowed across all of it); the bias is toward *not*
 * pruning, which is always safe. Without this, a `.server` call on a binding
 * shadowed by a `catch`/block/loop declaration would be pruned incorrectly.
 */
function collectBlockScope(node: AstNode): Set<string> {
  const names = new Set<string>();
  switch (node.type) {
    case "BlockStatement":
    case "StaticBlock":
      collectLexicalBindings((node["body"] as AstNode[]) ?? [], names);
      break;
    case "CatchClause":
      collectPatternNames(node["param"] as AstNode | undefined, names);
      break;
    case "ForStatement":
      collectForBindings(node["init"] as AstNode | undefined, names);
      break;
    case "ForInStatement":
    case "ForOfStatement":
      collectForBindings(node["left"] as AstNode | undefined, names);
      break;
    case "SwitchStatement":
      for (const switchCase of (node["cases"] as AstNode[]) ?? [])
        collectLexicalBindings((switchCase["consequent"] as AstNode[]) ?? [], names);
      break;
    default:
      break;
  }
  return names;
}

/**
 * Find every `<binding>.server(…)` call whose `<binding>` resolves to a live
 * (non-shadowed) `Boundary` import, invoking `onCall` for each.
 */
function findServerCalls(
  program: AstNode,
  bindings: ReadonlySet<string>,
  onCall: (call: AstNode) => void,
): void {
  // Counts active inner-scope shadows per name; a name is "live" when imported
  // and not currently shadowed.
  const shadow = new Map<string, number>();
  const pushScope = (names: ReadonlySet<string>): void => {
    for (const n of names) shadow.set(n, (shadow.get(n) ?? 0) + 1);
  };
  const popScope = (names: ReadonlySet<string>): void => {
    for (const n of names) {
      const next = (shadow.get(n) ?? 0) - 1;
      if (next <= 0) shadow.delete(n);
      else shadow.set(n, next);
    }
  };
  const isLive = (name: string): boolean => bindings.has(name) && !shadow.has(name);

  const walk = (node: unknown): void => {
    if (!isNode(node)) return;

    if (node.type === "CallExpression") {
      const callee = node["callee"] as AstNode | undefined;
      if (
        callee &&
        callee.type === "MemberExpression" &&
        callee["computed"] !== true &&
        isNode(callee["object"]) &&
        (callee["object"] as AstNode).type === "Identifier" &&
        isNode(callee["property"]) &&
        (callee["property"] as AstNode).type === "Identifier" &&
        (callee["property"] as AstNode)["name"] === SERVER_METHOD &&
        isLive((callee["object"] as AstNode)["name"] as string)
      ) {
        onCall(node);
      }
    }

    const isFunction =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";
    // Functions bind params + hoisted names; all other constructs (blocks,
    // catch, loops, switch) bind their lexical declarations. Both shadow the
    // outer `Boundary` import for the duration of the node's children.
    const scopeNames = isFunction ? collectFunctionScope(node) : collectBlockScope(node);
    if (scopeNames.size > 0) pushScope(scopeNames);

    for (const key in node) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) for (const c of child) walk(c);
      else walk(child);
    }

    if (scopeNames.size > 0) popScope(scopeNames);
  };

  walk(program);
}

/** A half-open `[start, end)` source range slated for removal. */
type Range = readonly [number, number];

/** Sort ranges and merge any that overlap or touch, so removals never collide. */
function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur[0] <= last[1]) merged[merged.length - 1] = [last[0], Math.max(last[1], cur[1])];
    else merged.push(cur);
  }
  return merged;
}

/** Index of the first comma in `code` within `[from, limit)`, else `from`. */
function commaBetween(code: string, from: number, limit: number): number {
  for (let i = from; i < limit; i++) if (code[i] === ",") return i;
  return from;
}

/**
 * End offset of a trailing comma following the last property, if any: scans
 * `[from, limit)` (where `limit` is the object's closing `}`) and returns the
 * index *after* the comma so it is swallowed, else `from`. Removing the last
 * property without this would leave a dangling `,` (e.g. `{ , }`) when every
 * property is pruned.
 */
function trailingCommaEnd(code: string, from: number, limit: number): number {
  for (let i = from; i < limit; i++) if (code[i] === ",") return i + 1;
  return from;
}

/**
 * Build the removal ranges for the target properties, each extended to swallow
 * its separating comma so the surviving object stays syntactically valid.
 */
function removalRanges(code: string, object: AstNode, targets: AstNode[]): Range[] {
  const props = (object["properties"] as AstNode[]) ?? [];
  const ranges: Range[] = [];
  for (const target of targets) {
    const idx = props.indexOf(target);
    const next = props[idx + 1];
    if (next) {
      // Not last: drop the property up to the next one (its trailing comma + ws).
      ranges.push([target.start, next.start]);
    } else {
      // Last: drop the preceding comma (so no dangling separator remains) and a
      // trailing comma if present (so an all-pruned object collapses to `{}`
      // rather than `{ , }`). `object.end - 1` is the closing `}`.
      const prev = props[idx - 1];
      const from = prev ? commaBetween(code, prev.end, target.start) : target.start;
      ranges.push([from, trailingCommaEnd(code, target.end, object.end - 1)]);
    }
  }
  return mergeRanges(ranges);
}

/**
 * Strip `load` and `provide` from every prunable `Boundary.server` call in
 * `code`. `program` must be the ESTree AST for `code` (from the plugin context's
 * `this.parse`, or `parseAst` in tests).
 *
 * Returns `null` when the module has no `Boundary` import or no matching
 * `.server` call — the caller should then emit no transform. Otherwise returns a
 * {@link PruneResult}: `changed` is `true` only if a property was removed, and
 * `warnings` lists call sites skipped because their first argument is not an
 * inline object literal.
 */
export function pruneServerBoundaries(code: string, program: AstNode): PruneResult | null {
  const bindings = findBoundaryBindings(program);
  if (bindings.size === 0) return null;

  const calls: AstNode[] = [];
  findServerCalls(program, bindings, (call) => calls.push(call));
  if (calls.length === 0) return null;

  const magic = new MagicString(code);
  const warnings: PruneWarning[] = [];
  let changed = false;

  for (const call of calls) {
    const args = call["arguments"] as AstNode[] | undefined;
    const first = args?.[0];
    const hasSpread =
      first?.type === "ObjectExpression" &&
      ((first["properties"] as AstNode[]) ?? []).some((p) => p.type === "SpreadElement");

    if (!first || first.type !== "ObjectExpression" || hasSpread) {
      warnings.push({
        message:
          "`Boundary.server` first argument is not an inline object literal (or uses spread); " +
          "server-only `load`/`provide` could not be pruned and may ship to the client bundle.",
        pos: call.start,
      });
      continue;
    }

    const targets = ((first["properties"] as AstNode[]) ?? []).filter(
      // Getters/methods are `Property` too and prune safely; `hasStrippedKey`
      // gates computed keys (static string literal yes, dynamic identifier no).
      (p) => p.type === "Property" && hasStrippedKey(p),
    );
    if (targets.length === 0) continue; // already pruned, or nothing to strip

    for (const [start, end] of removalRanges(code, first, targets)) magic.remove(start, end);
    changed = true;
  }

  return {
    changed,
    code: changed ? magic.toString() : code,
    map: changed ? magic.generateMap({ hires: true }) : null,
    warnings,
  };
}

/** Whether a `Property` node's static key is `load` or `provide`. */
function hasStrippedKey(prop: AstNode): boolean {
  const key = prop["key"] as AstNode | undefined;
  if (!key) return false;
  const name = staticKeyName(key, prop["computed"] === true);
  return name !== null && STRIPPED_KEYS.has(name);
}
