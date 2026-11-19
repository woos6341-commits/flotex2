import { eq } from "drizzle-orm";
import { appSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { storagePut } from "./storage";

export const USER_SHARE_FILE_KEY = "user_share_file_v1";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;
const MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

type ShareFile = { key: string; fileName: string; mimeType: string; url: string; updatedAt: string };

function parseShareFile(value: string | null | undefined): ShareFile | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ShareFile>;
    if (typeof parsed.key !== "string" || typeof parsed.fileName !== "string" || typeof parsed.mimeType !== "string" || typeof parsed.url !== "string" || typeof parsed.updatedAt !== "string") return null;
    return parsed as ShareFile;
  } catch { return null; }
}

export async function getUserShareFile(): Promise<ShareFile | null> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, USER_SHARE_FILE_KEY)).limit(1);
  return parseShareFile(row?.value);
}

export async function uploadUserShareFile(adminId: number, input: { fileName: string; mimeType: string; data: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const fileName = input.fileName.trim();
  if (!FILE_NAME_RE.test(fileName) || fileName.includes("..")) throw new Error("اسم الملف غير صالح");
  if (!MIME_TYPES.has(input.mimeType)) throw new Error("نوع الملف غير مسموح");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw new Error("بيانات الملف غير صالحة");
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error("حجم الملف يتجاوز الحد المسموح");
  const uploaded = await storagePut(`user-share/${Date.now()}-${fileName}`, bytes, input.mimeType);
  const value: ShareFile = { key: uploaded.key, fileName, mimeType: input.mimeType, url: uploaded.url, updatedAt: new Date().toISOString() };
  await db.insert(appSettings).values({ key: USER_SHARE_FILE_KEY, value: JSON.stringify(value), updatedBy: adminId }).onDuplicateKeyUpdate({ set: { value: JSON.stringify(value), updatedBy: adminId } });
  return value;
}
