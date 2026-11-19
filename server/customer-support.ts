import { eq } from "drizzle-orm";
import { appSettings } from "../drizzle/schema";
import {
  customerSupportSettingsSchema,
  EMPTY_CUSTOMER_SUPPORT_SETTINGS,
  parseStoredCustomerSupportSettings,
  type CustomerSupportSettings,
} from "../shared/customer-support";
import { requireAdministrator } from "./payment-settings";
import { getDb } from "./db";

export const CUSTOMER_SUPPORT_SETTINGS_KEY = "customer_support_settings";

export async function getCustomerSupportSettings(): Promise<CustomerSupportSettings> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, CUSTOMER_SUPPORT_SETTINGS_KEY))
    .limit(1);
  return row ? parseStoredCustomerSupportSettings(row.value) : { ...EMPTY_CUSTOMER_SUPPORT_SETTINGS };
}

export async function updateCustomerSupportSettings(adminId: number, input: unknown): Promise<CustomerSupportSettings> {
  const db = await requireAdministrator(adminId);
  const settings = customerSupportSettingsSchema.parse(input);
  const value = JSON.stringify(settings);
  await db
    .insert(appSettings)
    .values({ key: CUSTOMER_SUPPORT_SETTINGS_KEY, value, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
  return settings;
}
