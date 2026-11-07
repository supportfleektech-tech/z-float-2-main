/**
 * Node.js specific ESLint config extending the base config.
 * For worker, outbox-relay, and other Node-only packages.
 */
const baseConfig = require("./base.js");

module.exports = {
  ...baseConfig,
  env: {
    ...baseConfig.env,
    node: true,
  },
  rules: {
    ...baseConfig.rules,
    // Node.js specific - allow console in worker/seed/scripts
    "no-console": "off",
    // Disable React/JSX rules for Node-only packages
    "react/react-in-jsx-scope": "off",
    "jsx-a11y/anchor-is-valid": "off",
  },
  overrides: [
    ...baseConfig.overrides,
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
};