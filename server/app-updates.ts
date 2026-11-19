import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { appSettings, notifications, users } from "../drizzle/schema";
import {
  ANDROID_APK_MIME_TYPE,
  DISABLED_ANDROID_UPDATE_POLICY,
  isAndroidApkFileName,
  isReleaseVersion,
  isSafeAndroidUpdateStorageKey,
  isSafeHttpsDownloadUrl,
  isValidAndroidApkSize,
  toPublicAndroidUpdatePolicy,
  type AndroidUpdatePolicy,
} from "../shared/app-updates";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";
import { storageCreateUploadUrl, storageGetSignedUrl } from "./storage";

const ANDROID_UPDATE_POLICY_KEY = "android_update_policy";

function parsePolicy(value: string | undefined): AndroidUpdatePolicy {
  if (!value) return { ...DISABLED_ANDROID_UPDATE_POLICY };
  try {
    const parsed = JSON.parse(value) as Partial<AndroidUpdatePolicy>;
    const policy: AndroidUpdatePolicy = {
      enabled: parsed.enabled === true,
      version: typeof parsed.version === "string" ? parsed.version.trim() : "",
      buildNumber: Number.isSafeInteger(parsed.buildNumber) && Number(parsed.buildNumber) > 0 ? Number(parsed.buildNumber) : 1,
      downloadUrl: typeof parsed.downloadUrl === "string" ? parsed.downloadUrl.trim() : "",
      storageKey: typeof parsed.storageKey === "string" ? parsed.storageKey.trim() : "",
      releaseNotes: typeof parsed.releaseNotes === "string" ? parsed.releaseNotes.slice(0, 4000) : "",
      mandatory: parsed.enabled === true,
    };
    if (!policy.enabled) return { ...policy, mandatory: false };
    const hasStoredApk = isSafeAndroidUpdateStorageKey(policy.storageKey ?? "", policy.version);
    const hasLegacyUrl = isSafeHttpsDownloadUrl(policy.downloadUrl);
    if (!isReleaseVersion(policy.version) || (!hasStoredApk && !hasLegacyUrl)) {
      return { ...DISABLED_ANDROID_UPDATE_POLICY };
    }
    return policy;
  } catch {
    return { ...DISABLED_ANDROID_UPDATE_POLICY };
  }
}

export async function getAndroidUpdatePolicy(): Promise<AndroidUpdatePolicy> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [row] = await db.select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, ANDROID_UPDATE_POLICY_KEY))
    .limit(1);
  return parsePolicy(row?.value);
}

export async function getPublicAndroidUpdatePolicy(): Promise<AndroidUpdatePolicy> {
  return toPublicAndroidUpdatePolicy(await getAndroidUpdatePolicy());
}

export async function createAndroidUpdateUploadUrl(
  adminId: number,
  input: { version: string; buildNumber: number; fileName: string; fileSize: number },
): Promise<{ key: string; uploadUrl: string; contentType: string }> {
  await requireAdministrator(adminId);
  const version = input.version.trim();
  if (!isReleaseVersion(version)) throw new Error("أدخل رقم إصدار صالحًا قبل رفع APK.");
  if (!Number.isSafeInteger(input.buildNumber) || input.buildNumber < 1) throw new Error("أدخل رقم بناء Android صالحًا قبل رفع APK.");
  if (!isAndroidApkFileName(input.fileName)) throw new Error("اختر ملفًا ينتهي بامتداد APK فقط.");
  if (!isValidAndroidApkSize(input.fileSize)) {
    throw new Error("حجم APK غير صالح أو يتجاوز الحد الأقصى 200 ميجابايت.");
  }

  const key = `flotex-egp/android-updates/${version}/${input.buildNumber}-${randomUUID()}.apk`;
  const upload = await storageCreateUploadUrl(key);
  return { ...upload, contentType: ANDROID_APK_MIME_TYPE };
}

export async function getAndroidUpdateDownloadUrl(expectedVersion: string): Promise<{ version: string; url: string }> {
  const policy = await getAndroidUpdatePolicy();
  if (!policy.enabled || policy.version !== expectedVersion.trim()) {
    throw new Error("لم يعد هذا الإصدار متاحًا للتنزيل؛ حدّث شاشة التطبيق وحاول مجددًا.");
  }

  if (isSafeAndroidUpdateStorageKey(policy.storageKey ?? "", policy.version)) {
    const url = await storageGetSignedUrl(policy.storageKey!);
    return { version: policy.version, url };
  }
  if (isSafeHttpsDownloadUrl(policy.downloadUrl)) {
    return { version: policy.version, url: policy.downloadUrl };
  }
  throw new Error("لا يوجد ملف APK صالح لهذا الإصدار.");
}

export function normalizeAndroidUpdatePolicy(input: AndroidUpdatePolicy): AndroidUpdatePolicy {
  const policy: AndroidUpdatePolicy = {
    enabled: input.enabled,
    version: input.version.trim(),
    buildNumber: input.buildNumber,
    downloadUrl: input.downloadUrl.trim(),
    storageKey: input.storageKey?.trim() ?? "",
    releaseNotes: input.releaseNotes.trim(),
    mandatory: input.enabled,
  };
  if (policy.releaseNotes.length > 4000) throw new Error("ملاحظات الإصدار تتجاوز الحد المسموح");
  if (policy.enabled) {
    if (!isReleaseVersion(policy.version)) throw new Error("رقم الإصدار يجب أن يكون بصيغة مثل 1.0.1");
    if (!Number.isSafeInteger(policy.buildNumber) || policy.buildNumber < 1) throw new Error("رقم البناء يجب أن يكون عددًا صحيحًا موجبًا");
    const hasStoredApk = isSafeAndroidUpdateStorageKey(policy.storageKey ?? "", policy.version);
    const hasLegacyUrl = isSafeHttpsDownloadUrl(policy.downloadUrl);
    if (!hasStoredApk && !hasLegacyUrl) throw new Error("ارفع ملف APK صالحًا لهذا الإصدار قبل تفعيله.");
    if (hasStoredApk) policy.downloadUrl = "";
  } else {
    policy.mandatory = false;
    policy.storageKey = "";
    policy.downloadUrl = "";
  }
  return policy;
}

export async function updateAndroidUpdatePolicy(
  adminId: number,
  input: AndroidUpdatePolicy,
): Promise<AndroidUpdatePolicy> {
  const db = await requireAdministrator(adminId);
  const policy = normalizeAndroidUpdatePolicy(input);
  const [previous] = await db.select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, ANDROID_UPDATE_POLICY_KEY))
    .limit(1);
  if (policy.enabled && !isSafeAndroidUpdateStorageKey(policy.storageKey ?? "", policy.version)) {
    throw new Error("ارفع ملف APK مباشرة من لوحة الإدارة قبل حفظ سياسة الإصدار الجديد.");
  }

  const value = JSON.stringify(policy);
  await db.insert(appSettings)
    .values({ key: ANDROID_UPDATE_POLICY_KEY, value, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
  if (policy.enabled && previous?.value !== value) {
    const recipients = await db.select({ id: users.id }).from(users).where(eq(users.role, "user"));
    if (recipients.length) {
      const operationId = `android-update:${policy.version}:${policy.buildNumber}`;
      await db.insert(notifications).values(recipients.map((recipient) => ({
        userId: recipient.id,
        createdBy: adminId,
        title: "يتوفر تحديث جديد لتطبيق Flotex EGP",
        body: `الإصدار ${policy.version} متاح الآن. افتح التطبيق لتنزيل التحديث الجديد.`,
        type: "app_update",
        operationId,
      }))).onDuplicateKeyUpdate({ set: { title: "يتوفر تحديث جديد لتطبيق Flotex EGP", body: `الإصدار ${policy.version} متاح الآن. افتح التطبيق لتنزيل التحديث الجديد.`, createdBy: adminId } });
    }
  }
  return policy;
}
