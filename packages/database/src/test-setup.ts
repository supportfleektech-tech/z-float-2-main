/**
 * Shared vitest setup: loads the repo-root .env so integration tests can use
 * real PostgreSQL/Redis the same way the app does.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../../.env"), quiet: true, override: false });

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
// Route integration tests to the dedicated test database (DATABASE_URL_TEST)
// so they can never touch the dev/live database.
process.env.IS_TEST = "true";
