import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { resolve } from "node:path";
import * as schema from "./schema.ts";

export type AppDatabase = PgliteDatabase<typeof schema>;

export interface DatabaseHandle {
  db: AppDatabase;
  mode: "pglite" | "postgres";
  close: () => Promise<void>;
}

export async function openDatabase(databaseUrl = process.env.DATABASE_URL): Promise<DatabaseHandle> {
  const migrationsFolder = resolve(process.cwd(), "server/drizzle");
  if (databaseUrl?.startsWith("postgres://") || databaseUrl?.startsWith("postgresql://")) {
    const pool = new Pool({ connectionString: databaseUrl, max: 10 });
    const postgresDb = drizzleNodePostgres(pool, { schema });
    await migrateNodePostgres(postgresDb, { migrationsFolder });
    return {
      db: postgresDb as unknown as AppDatabase,
      mode: "postgres",
      close: () => pool.end(),
    };
  }

  const dataDirectory = databaseUrl?.startsWith("memory://")
    ? "memory://"
    : databaseUrl?.replace(/^pglite:\/\//, "") || process.env.PGLITE_DATA_DIR || resolve(process.cwd(), ".egain-data");
  const client = new PGlite(dataDirectory);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return {
    db,
    mode: "pglite",
    close: () => client.close(),
  };
}
