import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { ServerConfig } from "../config.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export type AppDatabase = NodePgDatabase<typeof schema>;
export type PgPool = pg.Pool;

export interface DatabaseClient {
  db: AppDatabase;
  pool: PgPool;
  close: () => Promise<void>;
}

export function createDatabaseClient(config: ServerConfig): DatabaseClient {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 5,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}
