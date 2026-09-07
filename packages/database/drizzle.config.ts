import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./custom-migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "",
  },
});
