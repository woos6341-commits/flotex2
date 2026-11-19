import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { appSettings } from "../drizzle/schema";
import {
  contactButtonInputSchema,
  contactButtonSchema,
  normalizeContactButtonTarget,
  type ContactButton,
} from "../shared/contact-buttons";
import { requireAdministrator } from "./payment-settings";
import { getDb } from "./db";

const CONTACT_BUTTONS_KEY = "payment_contact_buttons";
const CONTACT_BUTTON_ID = /^contact_[a-f0-9]{12}$/;
type AppDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function readButtons(db: AppDb): Promise<ContactButton[]> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CONTACT_BUTTONS_KEY)).limit(1);
  if (!row) return [];
  try {
    const value: unknown = JSON.parse(row.value);
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => contactButtonSchema.safeParse(item))
      .filter((item): item is { success: true; data: ContactButton } => item.success)
      .map((item) => item.data)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

async function saveButtons(db: AppDb, adminId: number, buttons: ContactButton[]) {
  const value = JSON.stringify(buttons);
  await db.insert(appSettings).values({ key: CONTACT_BUTTONS_KEY, value, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
}

function normalizeButton(input: unknown, id: string, sortOrder: number): ContactButton {
  const parsed = contactButtonInputSchema.parse(input);
  return contactButtonSchema.parse({
    ...parsed,
    target: normalizeContactButtonTarget(parsed.type, parsed.target),
    id,
    sortOrder,
  });
}

export async function getContactButtons(): Promise<ContactButton[]> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return (await readButtons(db)).filter((button) => button.visible);
}

export async function getAdminContactButtons(adminId: number): Promise<ContactButton[]> {
  const db = await requireAdministrator(adminId);
  return readButtons(db);
}

export async function createContactButton(adminId: number, input: unknown): Promise<ContactButton> {
  const db = await requireAdministrator(adminId);
  const buttons = await readButtons(db);
  const button = normalizeButton(input, `contact_${randomBytes(6).toString("hex")}`, buttons.length);
  const next = [...buttons, button];
  await saveButtons(db, adminId, next);
  return button;
}

export async function updateContactButton(adminId: number, id: string, input: unknown): Promise<ContactButton> {
  if (!CONTACT_BUTTON_ID.test(id)) throw new Error("معرّف زر التواصل غير صالح");
  const db = await requireAdministrator(adminId);
  const buttons = await readButtons(db);
  const index = buttons.findIndex((button) => button.id === id);
  if (index < 0) throw new Error("زر التواصل غير موجود");
  const updated = normalizeButton(input, id, buttons[index].sortOrder);
  const next = buttons.map((button, itemIndex) => itemIndex === index ? updated : button);
  await saveButtons(db, adminId, next);
  return updated;
}

export async function deleteContactButton(adminId: number, id: string) {
  if (!CONTACT_BUTTON_ID.test(id)) throw new Error("معرّف زر التواصل غير صالح");
  const db = await requireAdministrator(adminId);
  const buttons = await readButtons(db);
  if (!buttons.some((button) => button.id === id)) throw new Error("زر التواصل غير موجود");
  const next = buttons.filter((button) => button.id !== id).map((button, sortOrder) => ({ ...button, sortOrder }));
  await saveButtons(db, adminId, next);
  return { success: true };
}

export async function reorderContactButtons(adminId: number, ids: string[]) {
  if (ids.some((id) => !CONTACT_BUTTON_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("ترتيب أزرار التواصل غير صالح");
  }
  const db = await requireAdministrator(adminId);
  const buttons = await readButtons(db);
  if (buttons.length !== ids.length || buttons.some((button) => !ids.includes(button.id))) {
    throw new Error("تغيرت قائمة الأزرار؛ حدّث القائمة وحاول مرة أخرى");
  }
  const byId = new Map(buttons.map((button) => [button.id, button]));
  const next = ids.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder }));
  await saveButtons(db, adminId, next);
  return next;
}
