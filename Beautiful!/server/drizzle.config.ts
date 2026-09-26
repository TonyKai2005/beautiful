import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./server/drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://egain:egain@127.0.0.1:5432/egain",
  },
  strict: true,
  verbose: true,
});
