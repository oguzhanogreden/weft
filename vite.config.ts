import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import tsconfigPaths from "vite-tsconfig-paths";
import { weftDocs } from "./website/src/lib/docs-plugin";

// The website's doc-model plugin is registered at the root so `virtual:weft-docs`
// resolves to the real baked docs under the shared test runner (`vp test`). It only
// activates for that virtual id, so other packages' tests are unaffected.
const docsRoot = fileURLToPath(new URL("docs", import.meta.url));

export default defineConfig({
  // `tsconfigPaths` resolves each package's `~/*` alias per-file from its own
  // tsconfig (the built-in `resolve.tsconfigPaths` reads only a root tsconfig, which
  // does not exist here, so `packages/*` tests could not resolve `~` under `vp test`).
  plugins: [
    tsconfigPaths({
      projects: [
        "packages/core/tsconfig.json",
        "packages/dom/tsconfig.json",
        "packages/router/tsconfig.json",
        "packages/vite/tsconfig.json",
      ],
    }),
    weftDocs({ docsRoot }),
  ],
  staged: {
    "*": "vp check --fix",
  },
  run: {
    tasks: {
      dev: {
        command: "vp run -r dev",
      },
      pack: {
        command: "vp run -r pack",
      },
      check: {
        command: "vp check",
        dependsOn: ["pack"],
      },
      test: {
        command: "vp test",
        dependsOn: ["pack"],
      },
      "test:browser": {
        command: "vp test --config vitest.browser.config.ts",
        dependsOn: ["pack"],
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/*.browser.test.{ts,tsx}"],
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "*.min.js", "**/.claude/**", "graphify-out"],
  },
  lint: {
    ignorePatterns: ["**/dist/**", "*.min.js", "**/.claude/**", "graphify-out"],
    plugins: ["typescript", "unicorn", "oxc"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    categories: {
      correctness: "error",
    },
    rules: {
      "typescript/no-floating-promises": [
        "error",
        {
          ignoreVoid: true,
        },
      ],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        files: ["*.test.{ts,tsx}"],
        rules: {
          "typescript/no-floating-promises": "off",
        },
      },
    ],
    env: {
      builtin: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
});
