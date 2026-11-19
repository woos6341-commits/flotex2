import { and, desc, eq, inArray } from "drizzle-orm";
import {
  globalUiButtonVisibility,
  uiButtonVisibilityAudit,
  userUiButtonVisibility,
  users,
} from "../drizzle/schema";
import {
  isUiButtonId,
  resolveUiButtonVisibility,
  UI_BUTTONS,
  type UiButtonOverrideMode,
  type UiSurface,
} from "../shared/ui-button-visibility";
import { getDb } from "./db";
import { getHomeActionOrderForUser } from "./home-action-order";

function keyOf(surface: UiSurface, buttonId: string) {
  return `${surface}:${buttonId}`;
}

function assertKnownButton(surface: UiSurface, buttonId: string) {
  if (!isUiButtonId(surface, buttonId)) throw new Error("الزر المطلوب غير موجود في قائمة واجهات التطبيق");
}

function normalizeReason(value: string | undefined) {
  return value?.trim().slice(0, 500) || null;
}

export async function getMyUiButtonVisibility(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const [globalRows, overrides, homeActionOrder] = await Promise.all([
    db.select().from(globalUiButtonVisibility),
    db.select().from(userUiButtonVisibility).where(eq(userUiButtonVisibility.userId, userId)),
    getHomeActionOrderForUser(userId),
  ]);
  const globalByKey = new Map(globalRows.map((row) => [keyOf(row.surface, row.buttonId), row]));
  const overrideByKey = new Map(overrides.map((row) => [keyOf(row.surface, row.buttonId), row]));
  const result: Record<UiSurface, Record<string, { visible: boolean }>> = { home: {}, wallet: {} };

  for (const surface of Object.keys(UI_BUTTONS) as UiSurface[]) {
    for (const button of UI_BUTTONS[surface]) {
      const key = keyOf(surface, button.id);
      const globalVisible = globalByKey.get(key)?.visible ?? true;
      const override = overrideByKey.get(key)?.mode ?? "inherit";
      result[surface][button.id] = { visible: resolveUiButtonVisibility(globalVisible, override) };
    }
  }
  return { ...result, homeActionOrder };
}

export async function getAdminGlobalUiButtonVisibility() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const rows = await db.select().from(globalUiButtonVisibility);
  const byKey = new Map(rows.map((row) => [keyOf(row.surface, row.buttonId), row]));
  return (Object.keys(UI_BUTTONS) as UiSurface[]).flatMap((surface) => UI_BUTTONS[surface].map((button) => {
    const saved = byKey.get(keyOf(surface, button.id));
    return {
      surface,
      buttonId: button.id,
      label: button.label,
      visible: saved?.visible ?? true,
      reason: saved?.reason ?? null,
      updatedAt: saved?.updatedAt ?? null,
    };
  }));
}

export async function getAdminCustomerUiButtonVisibility(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const [target] = await db.select({ id: users.id, role: users.role, name: users.name, customerId: users.customerId })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!target || target.role !== "user") throw new Error("حساب العميل غير موجود");
  const [globalRows, overrides] = await Promise.all([
    db.select().from(globalUiButtonVisibility),
    db.select().from(userUiButtonVisibility).where(eq(userUiButtonVisibility.userId, userId)),
  ]);
  const globalByKey = new Map(globalRows.map((row) => [keyOf(row.surface, row.buttonId), row]));
  const overrideByKey = new Map(overrides.map((row) => [keyOf(row.surface, row.buttonId), row]));
  const buttons = (Object.keys(UI_BUTTONS) as UiSurface[]).flatMap((surface) => UI_BUTTONS[surface].map((button) => {
    const key = keyOf(surface, button.id);
    const global = globalByKey.get(key);
    const override = overrideByKey.get(key);
    const mode: UiButtonOverrideMode = override?.mode ?? "inherit";
    const globalVisible = global?.visible ?? true;
    return {
      surface,
      buttonId: button.id,
      label: button.label,
      globalVisible,
      overrideMode: mode,
      visible: resolveUiButtonVisibility(globalVisible, mode),
      reason: mode === "inherit" ? global?.reason ?? null : override?.reason ?? null,
    };
  }));
  return { user: target, buttons };
}

export async function setGlobalUiButtonVisibility(
  actorId: number,
  input: { surface: UiSurface; buttonId: string; visible: boolean; reason?: string },
) {
  assertKnownButton(input.surface, input.buttonId);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const reason = normalizeReason(input.reason);
  const changed = await db.transaction(async (tx: any) => {
    const [current] = await tx.select().from(globalUiButtonVisibility).where(and(
      eq(globalUiButtonVisibility.surface, input.surface),
      eq(globalUiButtonVisibility.buttonId, input.buttonId),
    )).limit(1);
    if (current && current.visible === input.visible && (current.reason ?? null) === reason) return false;
    await tx.insert(globalUiButtonVisibility).values({
      surface: input.surface,
      buttonId: input.buttonId,
      visible: input.visible,
      reason,
      updatedBy: actorId,
    }).onDuplicateKeyUpdate({ set: { visible: input.visible, reason, updatedBy: actorId, updatedAt: new Date() } });
    await tx.insert(uiButtonVisibilityAudit).values({
      actorId,
      targetUserId: null,
      surface: input.surface,
      buttonId: input.buttonId,
      action: input.visible ? "shown" : "hidden",
      reason,
    });
    return true;
  });
  return { updated: changed };
}

export async function setCustomerUiButtonVisibility(
  actorId: number,
  input: { userId: number; surface: UiSurface; buttonId: string; mode: UiButtonOverrideMode; reason?: string },
) {
  assertKnownButton(input.surface, input.buttonId);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const reason = normalizeReason(input.reason);
  const changed = await db.transaction(async (tx: any) => {
    const [target] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target || target.role !== "user") throw new Error("حساب العميل غير موجود");
    const [current] = await tx.select().from(userUiButtonVisibility).where(and(
      eq(userUiButtonVisibility.userId, input.userId),
      eq(userUiButtonVisibility.surface, input.surface),
      eq(userUiButtonVisibility.buttonId, input.buttonId),
    )).limit(1);
    if (input.mode === "inherit") {
      if (!current) return false;
      await tx.delete(userUiButtonVisibility).where(eq(userUiButtonVisibility.id, current.id));
    } else {
      if (current && current.mode === input.mode && (current.reason ?? null) === reason) return false;
      await tx.insert(userUiButtonVisibility).values({
        userId: input.userId,
        surface: input.surface,
        buttonId: input.buttonId,
        mode: input.mode,
        reason,
        updatedBy: actorId,
      }).onDuplicateKeyUpdate({ set: { mode: input.mode, reason, updatedBy: actorId, updatedAt: new Date() } });
    }
    await tx.insert(uiButtonVisibilityAudit).values({
      actorId,
      targetUserId: input.userId,
      surface: input.surface,
      buttonId: input.buttonId,
      action: input.mode === "inherit" ? "inherit" : input.mode === "visible" ? "shown" : "hidden",
      reason,
    });
    return true;
  });
  return { updated: changed };
}

export async function getUiButtonVisibilityAudit(input: { targetUserId?: number; limit?: number } = {}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const rows = input.targetUserId
    ? await db.select().from(uiButtonVisibilityAudit)
      .where(eq(uiButtonVisibilityAudit.targetUserId, input.targetUserId))
      .orderBy(desc(uiButtonVisibilityAudit.createdAt), desc(uiButtonVisibilityAudit.id)).limit(limit)
    : await db.select().from(uiButtonVisibilityAudit)
      .orderBy(desc(uiButtonVisibilityAudit.createdAt), desc(uiButtonVisibilityAudit.id)).limit(limit);
  if (!rows.length) return [];
  const actorIds = [...new Set(rows.map((row) => row.actorId))];
  const targetIds = [...new Set(rows.flatMap((row) => row.targetUserId == null ? [] : [row.targetUserId]))];
  const [actors, targets] = await Promise.all([
    actorIds.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, actorIds)) : Promise.resolve([]),
    targetIds.length ? db.select({ id: users.id, name: users.name, customerId: users.customerId }).from(users).where(inArray(users.id, targetIds)) : Promise.resolve([]),
  ]);
  const actorById = new Map(actors.map((user) => [user.id, user]));
  const targetById = new Map(targets.map((user) => [user.id, user]));
  return rows.map((row) => ({
    ...row,
    actorName: actorById.get(row.actorId)?.name?.trim() || actorById.get(row.actorId)?.email || "مدير مخول",
    targetName: row.targetUserId == null ? null : targetById.get(row.targetUserId)?.name?.trim() || null,
    targetCustomerId: row.targetUserId == null ? null : targetById.get(row.targetUserId)?.customerId || null,
  }));
}
