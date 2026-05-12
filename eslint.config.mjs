const GENERATED_PREFIXES = Object.freeze([
  ".cloudflare/**",
  ".playwright-cli/**",
  ".wrangler/**",
  "build/**",
  "data/**",
  "dist/**",
  "logs/**",
  "node_modules/**",
  "out/**",
]);

export default [
  {
    ignores: [
      ...GENERATED_PREFIXES,
      "dashboard/public/*.json",
      "dashboard/public/*.js",
    ],
  },
  {
    files: ["src/**/*.mjs", "scripts/**/*.mjs", "test/**/*.mjs", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      complexity: ["error", 20],
    },
  },
];
