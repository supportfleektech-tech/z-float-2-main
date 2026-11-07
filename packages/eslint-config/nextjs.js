/**
 * Next.js specific ESLint config extending the base config.
 */
const baseConfig = require("./base.js");

module.exports = {
  ...baseConfig,
  extends: [
    ...baseConfig.extends,
    "plugin:@next/next/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
  ],
  plugins: [
    ...baseConfig.plugins,
    "@next/next",
    "react",
    "react-hooks",
    "jsx-a11y",
  ],
  rules: {
    ...baseConfig.rules,
    // Next.js specific
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    // React specific
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    // JSX A11y
    "jsx-a11y/anchor-is-valid": "off",
    "jsx-a11y/click-events-have-key-events": "warn",
    "jsx-a11y/no-noninteractive-element-interactions": "warn",
  },
  settings: {
    ...baseConfig.settings,
    react: {
      version: "18.3",
    },
  },
};