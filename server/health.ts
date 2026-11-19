import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Express } from "express";
import { getDb } from "./db";
const bootId = randomUUID(),
  startedAt = new Date().toISOString();
export function registerHealthRoutes(app: Express) {
  app.get("/api/health", (_req, res) =>
    res
      .set("Cache-Control", "no-store")
      .json({ ok: true, bootId, startedAt, timestamp: Date.now() }),
  );
  app.get("/api/ready", async (_req, res) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const db = await getDb();
      if (!db) throw new Error("Unavailable");
      await Promise.race([
        db.execute(sql`SELECT 1`),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Timeout")), 3000);
        }),
      ]);
      res
        .set("Cache-Control", "no-store")
        .json({ ok: true, database: "connected" });
    } catch {
      res
        .status(503)
        .set("Cache-Control", "no-store")
        .json({ ok: false, database: "unavailable" });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  });
}
