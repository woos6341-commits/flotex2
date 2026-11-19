import { desc, eq, sql } from "drizzle-orm";
import { savingsSettingAudits, savingsSettings } from "../drizzle/schema";
import { normalizeSavingsSettings, SAVINGS_SETTINGS_DEFAULTS, savingsSettingsInputSchema, type SavingsSettings } from "../shared/savings-settings";
import { requireAdministrator } from "./payment-settings";
import { getDb } from "./db";

const SETTINGS_ID = 1;
const trackedFields = ["minimumAmount", "feeAmount", "dailyRatePercent", "monthlyRatePercent", "yearlyRatePercent"] as const;
type TrackedField = (typeof trackedFields)[number];

async function ensureRow(db: any) {
  await db.insert(savingsSettings).values({ id: SETTINGS_ID, ...SAVINGS_SETTINGS_DEFAULTS })
    .onDuplicateKeyUpdate({ set: { id: sql`${savingsSettings.id}` } });
  const [row] = await db.select().from(savingsSettings).where(eq(savingsSettings.id, SETTINGS_ID)).limit(1);
  if (!row) throw new Error("تعذر تحميل إعدادات الإدخار");
  return row;
}

function toPublic(row: any): SavingsSettings {
  return {
    minimumAmount: row.minimumAmount,
    feeAmount: row.feeAmount,
    dailyRatePercent: row.dailyRatePercent,
    monthlyRatePercent: row.monthlyRatePercent,
    yearlyRatePercent: row.yearlyRatePercent,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt,
  };
}

export async function getSavingsSettings(): Promise<SavingsSettings> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return toPublic(await ensureRow(db));
}

export async function getAdminSavingsSettings(adminId: number) {
  const db = await requireAdministrator(adminId);
  const settings = toPublic(await ensureRow(db));
  const audits = await db.select().from(savingsSettingAudits)
    .orderBy(desc(savingsSettingAudits.changedAt)).limit(50);
  return { settings, audits };
}

export async function updateSavingsSettings(adminId: number, input: unknown) {
  const db = await requireAdministrator(adminId);
  const normalized = normalizeSavingsSettings(savingsSettingsInputSchema.parse(input));
  return db.transaction(async (tx: any) => {
    const current = await ensureRow(tx);
    const changes = trackedFields.filter((field) => current[field] !== normalized[field]);
    await tx.update(savingsSettings).set({ ...normalized, updatedBy: adminId }).where(eq(savingsSettings.id, SETTINGS_ID));
    for (const field of changes) {
      await tx.insert(savingsSettingAudits).values({
        adminId,
        field,
        oldValue: current[field],
        newValue: normalized[field],
      });
    }
    const [saved] = await tx.select().from(savingsSettings).where(eq(savingsSettings.id, SETTINGS_ID)).limit(1);
    return { settings: toPublic(saved), changedFields: changes };
  });
}
