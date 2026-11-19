import { randomUUID } from "node:crypto";
import { desc, eq, like } from "drizzle-orm";
import { appSettings } from "../drizzle/schema";
import { isValidButtonLayout, type ButtonLayout, type LayoutSurface } from "../shared/button-layout";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";

const settingKey = (surface: LayoutSurface) => `button_layout_v1:${surface}`;
const auditPrefix = "button_layout_audit_v1:";

type AuditAction = "save" | "reset" | "legacy-global" | "legacy-customer" | "legacy-customer-reset";
export async function recordButtonLayoutAudit(tx: any, entry: { actorId: number; surface: LayoutSurface; action: AuditAction; before: unknown; after: unknown; targetUserId?: number; legacyOrderBefore?: string | null }) {
  const audit = JSON.stringify({ ...entry, at: new Date().toISOString() });
  await tx.insert(appSettings).values({ key: `${auditPrefix}${Date.now()}:${randomUUID()}`, value: audit, updatedBy: entry.actorId });
}

function parseLayout(surface: LayoutSurface, value: string | undefined): ButtonLayout | null {
  if (!value) return null;
  try { const parsed: unknown = JSON.parse(value); return isValidButtonLayout(surface, parsed) ? parsed : null; }
  catch { return null; }
}

export async function getButtonLayout(surface: LayoutSurface): Promise<ButtonLayout | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, settingKey(surface))).limit(1);
  return parseLayout(surface, row?.value);
}

// The layout and immutable audit snapshot commit or roll back together. No new table is required.
export async function writeButtonLayout(actorId: number, surface: LayoutSurface, layout: ButtonLayout | null) {
  if (layout !== null && !isValidButtonLayout(surface, layout)) throw new Error("تخطيط الأزرار غير صالح أو تتداخل فيه الأزرار");
  const db = await requireAdministrator(actorId);
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, settingKey(surface))).for("update").limit(1);
    // Reset also clears the old global four-button order; personal overrides remain untouched.
    const [legacy] = layout === null && surface === "home"
      ? await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "home_action_order_v1")).for("update").limit(1)
      : [];
    if (layout === null) {
      await tx.delete(appSettings).where(eq(appSettings.key, settingKey(surface)));
      if (surface === "home") await tx.delete(appSettings).where(eq(appSettings.key, "home_action_order_v1"));
    } else {
      const value = JSON.stringify(layout);
      await tx.insert(appSettings).values({ key: settingKey(surface), value, updatedBy: actorId })
        .onDuplicateKeyUpdate({ set: { value, updatedBy: actorId, updatedAt: new Date() } });
    }
    await recordButtonLayoutAudit(tx, { surface, action: layout === null ? "reset" : "save", before: parseLayout(surface, before?.value), after: layout, legacyOrderBefore: legacy?.value ?? null, actorId });
  });
  return layout;
}

export async function getButtonLayoutAudit(actorId: number) {
  const db = await requireAdministrator(actorId);
  const rows = await db.select({ value: appSettings.value }).from(appSettings).where(like(appSettings.key, `${auditPrefix}%`)).orderBy(desc(appSettings.key)).limit(30);
  return rows.flatMap((row) => { try { return [JSON.parse(row.value) as { surface: LayoutSurface; action: AuditAction; actorId: number; targetUserId?: number; at: string }]; } catch { return []; } });
}
