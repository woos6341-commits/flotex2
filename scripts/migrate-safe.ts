import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

/** Conservative preflight. No write occurs until pending migrations pass. */
export function destructiveTargets(sql: string): string[] {
  const clean = sql.replace(/--[^\n]*/g, "");
  const targets = new Set<string>();
  for (const statement of clean.split(";")) {
    const drop = statement.match(/\b(?:DROP\s+TABLE(?:\s+IF\s+EXISTS)?|TRUNCATE(?:\s+TABLE)?)\s+`?([a-z_][a-z0-9_]*)`?/i);
    if (drop) targets.add(drop[1]);
    const dropColumn = statement.match(/\bALTER\s+TABLE\s+`?([a-z_][a-z0-9_]*)`?[\s\S]*?\bDROP\s+(?:COLUMN\s+)?`?(?!INDEX\b|KEY\b|CONSTRAINT\b|FOREIGN\b|PRIMARY\b)([a-z_][a-z0-9_]*)`?/i);
    if (dropColumn) targets.add(dropColumn[1]);
    const deletion = statement.match(/\bDELETE\s+FROM\s+`?([a-z_][a-z0-9_]*)`?/i);
    const alwaysTrue = /\bWHERE\s*\(*\s*(?:1\s*=\s*1|TRUE)\s*\)*(?:\s*$|\s+LIMIT\b)/i.test(statement);
    if (deletion && (!/\bWHERE\b/i.test(statement) || alwaysTrue)) targets.add(deletion[1]);
    const update = statement.match(/\bUPDATE\s+`?([a-z_][a-z0-9_]*)`?\s+SET\b/i);
    if (update && (!/\bWHERE\b/i.test(statement) || alwaysTrue)) targets.add(update[1]);
  }
  return [...targets];
}

export async function preflight() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; no migration was started.");
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const tables = await connection.query<any[]>("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
    const names = new Set(tables[0].map((row: { name: string }) => row.name));
    let lastApplied = 0;
    if (names.has("__drizzle_migrations")) {
      const [[row]] = await connection.query<any[]>("SELECT MAX(created_at) AS lastApplied FROM `__drizzle_migrations`");
      lastApplied = Number(row?.lastApplied ?? 0);
    }
    // Never guess a migration baseline for an already populated imported database.
    if (!lastApplied) {
      for (const name of ["users", "wallets", "transactions", "coin_wallets"]) {
        if (!names.has(name)) continue;
        const [[row]] = await connection.query<any[]>(`SELECT COUNT(*) AS count FROM \`${name}\``);
        if (Number(row.count)) throw new Error("REFUSED: populated database has no trusted migration history. Back up and baseline it manually; original balances were not modified.");
      }
    }
    const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8"));
    const pending = journal.entries.filter((entry: { when: number }) => entry.when > lastApplied);
    for (const entry of pending) {
      const sql = readFileSync(resolve("drizzle", `${entry.tag}.sql`), "utf8");
      for (const name of destructiveTargets(sql)) {
        if (!names.has(name)) continue;
        const [[row]] = await connection.query<any[]>(`SELECT COUNT(*) AS count FROM \`${name}\``);
        if (Number(row.count)) throw new Error(`REFUSED: pending migration ${entry.tag} has an unbounded/destructive write to populated table ${name}. No migration was started; review a data-preserving replacement.`);
      }
    }
    console.log(`Migration preflight passed (${pending.length} pending); existing customer data was read only.`);
  } finally {
    await connection.end();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; no migration was started.");
  const lockName = "flotexegp_schema_migrate_v1";
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  let lockAcquired = false;
  try {
    const [rows] = await connection.query<any[]>(`SELECT GET_LOCK('${lockName}', 60) AS acquired`);
    if (Number(rows[0]?.acquired) !== 1) throw new Error("Could not acquire the schema migration lock; no migration was started.");
    lockAcquired = true;
    await preflight();
    const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], { stdio: "inherit", env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Database migration did not complete successfully.");
  } finally {
    if (lockAcquired) await connection.query(`SELECT RELEASE_LOCK('${lockName}')`);
    await connection.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Migration refused"); process.exitCode = 1; });
}
