/**
 * ESLint 8 config for the Z-float monorepo root.
 * Base config without import resolver (each package has its own tsconfig).
 * Package-specific configs extend this and add import resolver with their project.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: [
    "@typescript-eslint",
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  env: {
    node: true,
    es2022: true,
    browser: true,
  },
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "**/.cache/**",
    "**/coverage/**",
    "apps/web/android/**",
    "apps/web/ios/**",
  ],
  rules: {
    "no-console": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "no-unused-vars": "off",
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/tests/**/*.ts", "**/e2e/**/*.ts"],
      env: { node: true },
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        afterAll: "readonly",
        afterEach: "readonly",
      },
    },
    {
      files: ["apps/web/**/*.{ts,tsx,js,jsx}"],
      plugins: ["@next/next", "react", "react-hooks", "jsx-a11y"],
      extends: [
        "plugin:@next/next/recommended",
        "plugin:react/recommended",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      rules: {
        "@next/next/no-img-element": "off",
        "@next/next/no-html-link-for-pages": "off",
        "react/react-in-jsx-scope": "off",
        "react/prop-types": "off",
        "jsx-a11y/anchor-is-valid": "off",
        "jsx-a11y/click-events-have-key-events": "warn",
        "jsx-a11y/no-noninteractive-element-interactions": "warn",
      },
      settings: {
        react: {
          version: "18.3",
        },
      },
    },
    {
      files: ["services/**/*.{ts,js}", "scripts/**/*.{ts,js}"],
      env: { node: true },
      rules: {
        "no-console": "off",
      },
      overrides: [
        {
          files: ["**/*.test.ts", "**/tests/**/*.ts", "**/e2e/**/*.ts"],
          env: { node: true },
          globals: {
            describe: "readonly",
            it: "readonly",
            test: "readonly",
            expect: "readonly",
            beforeAll: "readonly",
            beforeEach: "readonly",
            afterAll: "readonly",
            afterEach: "readonly",
          },
        },
      ],
    },
  ],
};