import { defineConfig } from "vite-plus";

export default defineConfig({
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
