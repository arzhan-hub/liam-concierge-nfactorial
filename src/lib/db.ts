import pg from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";

const globals = globalThis as unknown as {
  liamPool?: pg.Pool;
  liamSchema?: Promise<void>;
  liamSchemaVersion?: number;
};
export function pool() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "DATABASE_URL is required. Run npm run dev for local setup.",
    );
  return (globals.liamPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
  }));
}
export async function ensureSchema() {
  if (globals.liamSchemaVersion !== 7) {
    globals.liamSchema = undefined;
    globals.liamSchemaVersion = 7;
  }
  globals.liamSchema ??= (async () => {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(810209)");
      await client.query(
        await readFile(path.join(process.cwd(), "src/lib/schema.sql"), "utf8"),
      );
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const migration of [
        "001_social_signin.sql",
        "002_mail.sql",
        "003_manual_expectations.sql",
        "004_assistant.sql",
        "005_operations_tools.sql",
        "006_label_drafts.sql",
      ]) {
        if (
          !(
            await client.query(
              "SELECT 1 FROM schema_migrations WHERE name=$1",
              [migration],
            )
          ).rowCount
        ) {
          await client.query(
            await readFile(
              path.join(process.cwd(), "src/lib/migrations", migration),
              "utf8",
            ),
          );
          await client.query(
            "INSERT INTO schema_migrations(name) VALUES ($1)",
            [migration],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })();
  try {
    await globals.liamSchema;
  } catch (error) {
    globals.liamSchema = undefined;
    throw error;
  }
}
export async function transaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  await ensureSchema();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
