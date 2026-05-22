import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "*.min.js"],
  },
  lint: {
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
