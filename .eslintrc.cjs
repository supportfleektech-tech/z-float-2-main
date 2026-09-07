/**
 * ESLint 8 config for the Z-float monorepo (ESM packages, Next.js app,
 * Node worker). TypeScript-aware via @typescript-eslint.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, es2022: true, browser: true },
  ignorePatterns: [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "**/.cache/**",
    "**/coverage/**",
  ],
  rules: {
    // The app's logger is console in worker/seed/scripts (documented);
    // the code carries eslint-disable comments for the stricter mode.
    "no-console": "off",
    // Pragmatic for a demo codebase: allow explicit any, keep unused vars fatal.
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "no-unused-vars": "off",
    // Next.js apps legitimately use <img> in places and dynamic keys.
    "@next/next/no-img-element": "off",
  },
  overrides: [
    {
      // Test files: describe/it/expect globals
      files: ["**/*.test.ts", "**/tests/**/*.ts", "**/e2e/**/*.ts"],
      env: { node: true },
      globals: { describe: "readonly", it: "readonly", test: "readonly", expect: "readonly", beforeAll: "readonly", beforeEach: "readonly", afterAll: "readonly", afterEach: "readonly" },
    },
  ],
};
