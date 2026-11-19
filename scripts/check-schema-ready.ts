import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

/** Production startup is deliberately read-only: migrations require a reviewed backup and restore plan. */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; database was not modified.");
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [tables] = await connection.query<any[]>("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'");
    if (!tables.length) throw new Error("Database schema is not initialized; review and apply migrations separately.");
    const [[row]] = await connection.query<any[]>("SELECT MAX(created_at) AS lastApplied FROM `__drizzle_migrations`");
    const lastApplied = Number(row?.lastApplied ?? 0);
    const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8"));
    const pending = journal.entries.filter((entry: { when: number }) => entry.when > lastApplied);
    if (pending.length) throw new Error(`${pending.length} pending migrations require review and a backup/restore plan; startup did not change the database.`);
    console.log("Database migration history is current; startup performed no schema writes.");
  } finally {
    await connection.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Schema check failed"); process.exitCode = 1; });
