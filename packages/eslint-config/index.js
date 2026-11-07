/**
 * @zfloat/eslint-config — Centralized ESLint configurations for Z-float monorepo.
 *
 * Usage:
 *   // Base config (for all TypeScript packages)
 *   module.exports = require("@zfloat/eslint-config/base");
 *
 *   // Next.js config (for apps/web)
 *   module.exports = require("@zfloat/eslint-config/nextjs");
 *
 *   // Node.js config (for services/worker, services/outbox-relay, scripts)
 *   module.exports = require("@zfloat/eslint-config/node");
 */

module.exports = {
  base: require("./base.js"),
  nextjs: require("./nextjs.js"),
  node: require("./node.js"),
};