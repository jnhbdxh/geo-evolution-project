import "dotenv/config";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

const { Client } = pg;
const migrationUrl = process.env.DATABASE_MIGRATION_URL;

if (!migrationUrl) {
  throw new Error("DATABASE_MIGRATION_URL is required to run migrations");
}

const migrationsDirectory = path.resolve(process.cwd(), "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();

const client = new Client({ connectionString: migrationUrl });

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [7_501_001]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migrationFile of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, migrationFile), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const applied = await client.query<{ sha256: string }>(
      "SELECT sha256 FROM schema_migrations WHERE version = $1",
      [migrationFile],
    );

    if (applied.rowCount === 1) {
      if (applied.rows[0]?.sha256 !== sha256) {
        throw new Error(`Applied migration ${migrationFile} has changed; create a new migration`);
      }
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version, sha256) VALUES ($1, $2)", [
        migrationFile,
        sha256,
      ]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${migrationFile}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock($1)", [7_501_001]).catch(() => undefined);
  await client.end();
}
