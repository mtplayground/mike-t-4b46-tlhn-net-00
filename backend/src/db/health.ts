import type { PgPool } from "./client.js";

export interface DatabaseHealth {
  status: "ok" | "error";
  latencyMs?: number;
  message?: string;
}

export async function checkDatabaseHealth(pool: PgPool): Promise<DatabaseHealth> {
  const startedAt = Date.now();

  try {
    const result = await pool.query<{ ok: number }>("select 1 as ok");
    const ok = result.rows[0]?.ok === 1;

    if (!ok) {
      return {
        status: "error",
        message: "PostgreSQL health query returned an unexpected result",
      };
    }

    return {
      status: "ok",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error("PostgreSQL health check failed", error);
    return {
      status: "error",
      message: "PostgreSQL health check failed",
    };
  }
}
