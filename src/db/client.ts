import pg from "pg";

const { Pool } = pg;

// Reuse a single pool across serverless invocations (Vercel keeps the
// module cache warm between requests on the same instance).
let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // required by Supabase pooled connections
      max: 3, // keep small — serverless functions run many concurrent instances
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}
