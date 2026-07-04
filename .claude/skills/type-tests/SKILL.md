---
name: "type-tests"
description: "Step 3 of the Weft TDD workflow. Use after /mock: assesses whether the feature has meaningful type-level surface and, if so, writes __type-tests__/*.test-d.ts compile-time tests with @ts-expect-error assertions. If not applicable, records an explicit skip in specs.md — never a silent skip."
---

# /type-tests — Compile-time type tests (TDD step 3)

Verify the mocked type surface at compile time, or record an explicit, reasoned skip.

## When to run

- **Previous step:** `/mock` — the `declare`-based surface must exist in the source file.
- **Next step:** `/unit-test`.
- **Gate:** the step always concludes with either a `.test-d.ts` file or an explicit `type-tests: not applicable — <reason>` line in `specs.md`. Silent skips are forbidden.

## Procedure

1. **Assess applicability.** Does the feature have meaningful type-level behavior worth locking down?
   - Generics and generic constraints
   - Overloads
   - Conditional/inferred types (what does the compiler deduce for a consumer?)
   - Surfaces that must *reject* plausible-but-wrong usage

   Trivial concrete signatures (already fully enforced by the main typecheck) do not warrant a type test.

2. **If not applicable:** add to the feature's `specs.md`:

   ```markdown
   type-tests: not applicable — <one-line reason>
   ```

   Report the skip and reason to the user, then hand off to `/unit-test`.

3. **If applicable: write the test file** at `src/**/__type-tests__/<feature>.test-d.ts` in the owning package. Each file is self-contained and tests one feature. Pattern:

   ```typescript
   // Should compile - valid usage
   const _valid: SomeType = validValue;

   // @ts-expect-error - Should NOT compile - invalid usage
   const _invalid: SomeType = invalidValue;
   ```

   Cover:
   - Positive cases: valid usage compiles, inference lands on the expected types.
   - Negative cases: each `@ts-expect-error` asserts one specific rejection (wrong argument type, violated constraint, missing required prop). One assertion per error comment — a `@ts-expect-error` swallowing two mistakes proves nothing.

4. **Validate** with `vp run check` (never bare `vp check` — the pack rule). Both `packages/core` and `packages/dom` include `src/**/__type-tests__` in their tsconfig, so `@ts-expect-error` assertions are enforced by the main typecheck: an unused `@ts-expect-error` is itself an error.

5. **Hand off.** Next step is `/unit-test`.

## Rules

- `.test-d.ts` extension, under `__type-tests__/`, self-contained per feature.
- Type tests run against the mock surface — they must pass (typecheck) *before* implementation exists.
- If writing the tests reveals the mocked types are wrong: pause rule — back to `/spec` + `/mock` first.
