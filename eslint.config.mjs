import js from "@eslint/js";
import globals from "globals";

const commonRules = {
  "no-console": "off",
  "no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    },
  ],
};

export default [
  {
    ignores: [
      "node_modules/**",
      "data/**",
      "logs/**",
      "dashboard/public/**/*.json",
      "dashboard/public/**/*.js",
      "dashboard/public/*.json",
      "dashboard/public/*.js",
      ".cloudflare/**",
      ".wrangler/**",
      ".playwright-cli/**",
      "out/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.mjs", "test/**/*.mjs", "research/**/*.mjs", "*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: commonRules,
  },
  {
    files: ["dashboard/public/**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: commonRules,
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
];
