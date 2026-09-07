import path from "node:path";
import { defineConfig } from "vitest/config";

/** DSAR tests run against the shared real-PG test database (like other packages). */
export default defineConfig({
  test: {
    setupFiles: [path.resolve(__dirname, "../../packages/database/src/test-setup.ts")],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
