import { and, desc, eq } from "drizzle-orm";
import { authPasswordCredentials } from "../drizzle/auth-schema";
import { accountVerificationOverrides, accountVerifications, appSettings, phoneVerificationRequests, userProfileAudits, users } from "../drizzle/schema";
import { isDateOnlyNotFuture } from "../shared/date-only";
import { isValidEgyptianNationalId, normalizeEgyptianNationalId } from "../shared/national-id";
import { normalizePhoneNumber, phoneNumberSchema } from "../shared/registration";
import { decryptNationalId } from "./profile-data";
import {
  decodeAccountVerificationImage,
  decryptAccountVerificationDocument,
  encryptAccountVerificationDocument,
  fingerprintAccountVerificationValue,
  type VerificationImageInput,
} from "./account-verification-crypto";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";
import { readEffectiveVerificationState } from "./account-verification-state";

const REQUIREMENT_KEY = "account_verification_required_before_money";
const documentFields = ["idFront", "idBack", "selfie", "walletProfile"] as const;
export type AccountVerificationSubmission = Record<(typeof documentFields)[number], VerificationImageInput> & { birthDate: string };
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function isDuplicateEntry(error: unknown) {
  const value = error as { code?: string; errno?: number; message?: string } | null;
  return value?.code === "ER_DUP_ENTRY" || value?.errno === 1062 || /duplicate entry|unique constraint/i.test(value?.message ?? "");
}

async function readRequirement(db: Database) {
  const [setting] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, REQUIREMENT_KEY)).limit(1);
  return setting?.value === "true";
}

export async function getMyAccountVerificationStatus(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [state, requiredBeforeMoney] = await Promise.all([
    readEffectiveVerificationState(db, userId),
    readRequirement(db),
  ]);
  return { requiredBeforeMoney, ...state };
}

export async function submitAccountVerification(userId: number, input: AccountVerificationSubmission) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const images = Object.fromEntries(documentFields.map((field) => [field, decodeAccountVerificationImage(input[field])])) as Record<(typeof documentFields)[number], Buffer>;
  const encrypted = Object.fromEntries(documentFields.map((field) => [field, encryptAccountVerificationDocument(images[field])])) as Record<(typeof documentFields)[number], string>;
  const fingerprints = Object.fromEntries(documentFields.map((field) => [field, fingerprintAccountVerificationValue(`document:${field}`, images[field])])) as Record<(typeof documentFields)[number], string>;
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
      if (!user) throw new Error("الحساب غير موجود");
      if (!user.profileCompletedAt) throw new Error("أكمل بيانات التسجيل قبل إرسال طلب التوثيق");
      if (!user.name?.trim()) throw new Error("أكمل الاسم في ملف الحساب قبل إرسال طلب التوثيق");
      if (!isDateOnlyNotFuture(input.birthDate)) throw new Error("اختر تاريخ ميلاد صحيحًا لا يتجاوز اليوم");
      const parsedPhone = phoneNumberSchema.safeParse(user.phoneNumber ?? "");
      if (!parsedPhone.success || !user.phoneNormalized) throw new Error("أضف رقم هاتف صحيحًا إلى ملف الحساب أولًا");
      const normalizedPhone = normalizePhoneNumber(parsedPhone.data);
      if (normalizedPhone !== user.phoneNormalized) throw new Error("رقم الهاتف المحفوظ غير متطابق مع بيانات الحساب؛ حدّث الملف أولًا");
      if (!user.nationalIdCiphertext) throw new Error("أضف رقمك القومي إلى ملف الحساب قبل التوثيق");
      let nationalId: string;
      try { nationalId = normalizeEgyptianNationalId(decryptNationalId(user.nationalIdCiphertext)); }
      catch { throw new Error("تعذر التحقق من الرقم القومي المشفر؛ حدّثه من صفحة حسابي ثم أعد المحاولة"); }
      if (!isValidEgyptianNationalId(nationalId)) throw new Error("الرقم القومي المحفوظ غير صحيح");

      const [override] = await tx.select().from(accountVerificationOverrides)
        .where(eq(accountVerificationOverrides.userId, userId)).for("update").limit(1);
      const [existing] = await tx.select().from(accountVerifications).where(eq(accountVerifications.userId, userId)).for("update").limit(1);
      if (existing?.status === "pending") throw new Error("لديك طلب توثيق قيد المراجعة بالفعل");
      if (override?.status === "manual_verified") throw new Error("تم توثيق هذا الحساب بالفعل");
      if (existing?.status === "approved" && override?.status !== "revoked") throw new Error("تم توثيق هذا الحساب بالفعل");

      const nameSnapshot = user.name.trim();
      const phoneNumberSnapshot = parsedPhone.data;
      const nationalIdFingerprint = fingerprintAccountVerificationValue("national-id", nationalId);
      await tx.update(users).set({ nationalIdFingerprint }).where(eq(users.id, userId));
      const phoneFingerprint = fingerprintAccountVerificationValue("phone", user.phoneNormalized);
      const mimeType = (field: (typeof documentFields)[number]) => input[field].mimeType;
      const requestValues = {
        userId,
        status: "pending" as const,
        nameSnapshot,
        emailSnapshot: user.email ?? null,
        phoneNumberSnapshot,
        birthDateSnapshot: input.birthDate,
        nationalIdLast4: nationalId.slice(-4),
        nationalIdFingerprint,
        phoneFingerprint,
        idFrontFingerprint: fingerprints.idFront,
        idBackFingerprint: fingerprints.idBack,
        selfieFingerprint: fingerprints.selfie,
        walletProfileFingerprint: fingerprints.walletProfile,
        idFrontCiphertext: encrypted.idFront,
        idFrontMimeType: mimeType("idFront"),
        idBackCiphertext: encrypted.idBack,
        idBackMimeType: mimeType("idBack"),
        selfieCiphertext: encrypted.selfie,
        selfieMimeType: mimeType("selfie"),
        walletProfileCiphertext: encrypted.walletProfile,
        walletProfileMimeType: mimeType("walletProfile"),
        rejectionReason: null,
        verificationMethod: null,
        reviewedBy: null,
        reviewedAt: null,
        submittedAt: new Date(),
      };
      if (existing) await tx.update(accountVerifications).set(requestValues).where(eq(accountVerifications.id, existing.id));
      else await tx.insert(accountVerifications).values(requestValues);
      if (override?.status === "revoked") {
        await tx.delete(accountVerificationOverrides).where(eq(accountVerificationOverrides.userId, userId));
      }
      return { status: "pending" as const, submittedAt: requestValues.submittedAt };
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new Error("الرقم القومي أو رقم الهاتف أو إحدى وثائق الهوية مستخدمة في حساب آخر");
    throw error;
  }
}

export async function getAdminAccountVerificationSettings(adminId: number) {
  const db = await requireAdministrator(adminId);
  return { requiredBeforeMoney: await readRequirement(db) };
}

export async function updateAdminAccountVerificationSettings(adminId: number, requiredBeforeMoney: boolean) {
  const db = await requireAdministrator(adminId);
  const value = requiredBeforeMoney ? "true" : "false";
  await db.insert(appSettings).values({ key: REQUIREMENT_KEY, value, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
  return { requiredBeforeMoney };
}

export async function listAdminAccountVerificationRequests(adminId: number, status: "all" | "pending" | "approved" | "rejected" = "pending") {
  const db = await requireAdministrator(adminId);
  const selection = {
    id: accountVerifications.id,
    userId: accountVerifications.userId,
    status: accountVerifications.status,
    name: accountVerifications.nameSnapshot,
    email: accountVerifications.emailSnapshot,
    customerId: users.customerId,
    phoneNumber: accountVerifications.phoneNumberSnapshot,
    birthDate: accountVerifications.birthDateSnapshot,
    nationalIdLast4: accountVerifications.nationalIdLast4,
    rejectionReason: accountVerifications.rejectionReason,
    submittedAt: accountVerifications.submittedAt,
    reviewedAt: accountVerifications.reviewedAt,
  };
  const query = db.select(selection).from(accountVerifications).innerJoin(users, eq(users.id, accountVerifications.userId));
  if (status === "all") return query.orderBy(desc(accountVerifications.submittedAt)).limit(100);
  return query.where(eq(accountVerifications.status, status)).orderBy(desc(accountVerifications.submittedAt)).limit(100);
}

export async function getAdminAccountVerificationDocuments(adminId: number, userId: number) {
  const db = await requireAdministrator(adminId);
  const [row] = await db.select().from(accountVerifications).where(eq(accountVerifications.userId, userId)).limit(1);
  if (!row) throw new Error("طلب التوثيق غير موجود");
  const dataUrl = (encoded: string, mimeType: string) => `data:${mimeType};base64,${decryptAccountVerificationDocument(encoded).toString("base64")}`;
  return {
    userId: row.userId,
    status: row.status,
    name: row.nameSnapshot,
    email: row.emailSnapshot,
    phoneNumber: row.phoneNumberSnapshot,
    birthDate: row.birthDateSnapshot,
    nationalIdLast4: row.nationalIdLast4,
    documents: {
      idFront: dataUrl(row.idFrontCiphertext, row.idFrontMimeType),
      idBack: dataUrl(row.idBackCiphertext, row.idBackMimeType),
      selfie: dataUrl(row.selfieCiphertext, row.selfieMimeType),
      walletProfile: dataUrl(row.walletProfileCiphertext, row.walletProfileMimeType),
    },
  };
}

export async function updateAccountVerificationProfile(adminId: number, userId: number, input: { name: string; birthDate: string; phoneNumber: string }) {
  const db = await requireAdministrator(adminId);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 120) throw new Error("أدخل الاسم كاملًا بطول صحيح");
  if (!isDateOnlyNotFuture(input.birthDate)) throw new Error("اختر تاريخ ميلاد صحيحًا لا يتجاوز اليوم");
  const phoneNumber = phoneNumberSchema.parse(input.phoneNumber);
  const phoneNormalized = normalizePhoneNumber(phoneNumber);

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
      if (!user || user.role === "admin") throw new Error("حساب العميل غير موجود أو غير قابل للتعديل");
      const [request] = await tx.select().from(accountVerifications).where(eq(accountVerifications.userId, userId)).for("update").limit(1);
      if (!request || request.status !== "pending") throw new Error("يمكن تعديل البيانات من شاشة التوثيق أثناء مراجعة طلب معلق فقط");

      const [duplicatePhone] = await tx.select({ id: users.id }).from(users).where(eq(users.phoneNormalized, phoneNormalized)).limit(1);
      if (duplicatePhone && duplicatePhone.id !== userId) throw new Error("رقم الهاتف مرتبط بحساب آخر");

      const phoneChanged = user.phoneNormalized !== phoneNormalized;
      const nameParts = name.split(" ");
      const givenName = nameParts[0] ?? name;
      const fatherName = nameParts.slice(1).join(" ") || null;
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      if ((user.name ?? "") !== name) changes.name = { from: user.name ?? null, to: name };
      if ((user.birthDate ?? "") !== input.birthDate) changes.birthDate = { from: user.birthDate ?? null, to: input.birthDate };
      if ((user.phoneNumber ?? "") !== phoneNumber) changes.phoneNumber = { from: user.phoneNumber ?? null, to: phoneNumber };

      await tx.update(users).set({
        name,
        givenName,
        fatherName,
        birthDate: input.birthDate,
        phoneNumber,
        phoneNormalized,
        ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
      }).where(eq(users.id, userId));
      if (phoneChanged) {
        await tx.update(authPasswordCredentials).set({ phoneVerifiedAt: null }).where(eq(authPasswordCredentials.userId, userId));
        await tx.update(phoneVerificationRequests).set({ status: "cancelled", reviewedAt: new Date(), reviewedBy: adminId, reviewNote: "أُلغي الطلب بعد تحديث الهاتف ضمن توثيق الحساب" })
          .where(and(eq(phoneVerificationRequests.userId, userId), eq(phoneVerificationRequests.status, "pending")));
      }
      await tx.update(accountVerifications).set({
        nameSnapshot: name,
        birthDateSnapshot: input.birthDate,
        phoneNumberSnapshot: phoneNumber,
        phoneFingerprint: fingerprintAccountVerificationValue("phone", phoneNormalized),
      }).where(eq(accountVerifications.id, request.id));
      if (Object.keys(changes).length) {
        await tx.insert(userProfileAudits).values({ adminId, targetUserId: userId, changes: JSON.stringify(changes) });
      }
      return { success: true, userId, name, birthDate: input.birthDate, phoneNumber };
    });
  } catch (error) {
    if (isDuplicateEntry(error)) throw new Error("رقم الهاتف مرتبط بطلب توثيق في حساب آخر");
    throw error;
  }
}

export async function reviewAccountVerification(adminId: number, userId: number, decision: "approve" | "reject", rejectionReason?: string) {
  const db = await requireAdministrator(adminId);
  const cleanReason = rejectionReason?.trim() ?? "";
  if (decision === "reject" && cleanReason.length < 3) throw new Error("اكتب سببًا واضحًا لرفض طلب التوثيق");
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
    const [request] = await tx.select().from(accountVerifications).where(eq(accountVerifications.userId, userId)).for("update").limit(1);
    if (!user || !request) throw new Error("طلب التوثيق غير موجود");
    if (request.status !== "pending") throw new Error("تمت مراجعة هذا الطلب بالفعل؛ يمكن للمستخدم إعادة التقديم بعد الرفض فقط");
    if (decision === "approve" && (!request.idFrontCiphertext || !request.idBackCiphertext || !request.selfieCiphertext || !request.walletProfileCiphertext)) throw new Error("لا يمكن اعتماد طلب تنقصه إحدى وثائق الهوية");
    const nextStatus = decision === "approve" ? "approved" : "rejected";
    await tx.update(accountVerifications).set({
      status: nextStatus,
      rejectionReason: decision === "reject" ? cleanReason : null,
      verificationMethod: decision === "approve" ? "manual" : null,
      reviewedBy: adminId,
      reviewedAt: new Date(),
    }).where(eq(accountVerifications.id, request.id));
    if (decision === "approve") {
      const verifiedName = request.nameSnapshot.trim().replace(/\s+/g, " ");
      const verifiedPhone = phoneNumberSchema.parse(request.phoneNumberSnapshot);
      const verifiedBirthDate = request.birthDateSnapshot;
      if (!isDateOnlyNotFuture(verifiedBirthDate)) throw new Error("تاريخ الميلاد المسجل غير صالح أو يتجاوز اليوم؛ صححه قبل الاعتماد");
      const nameParts = verifiedName.split(" ");
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      if ((user.name ?? "") !== verifiedName) changes.name = { from: user.name ?? null, to: verifiedName };
      if ((user.birthDate ?? "") !== verifiedBirthDate) changes.birthDate = { from: user.birthDate ?? null, to: verifiedBirthDate };
      if ((user.phoneNumber ?? "") !== verifiedPhone) changes.phoneNumber = { from: user.phoneNumber ?? null, to: verifiedPhone };
      const phoneVerifiedAt = new Date();
      await tx.update(users).set({
        name: verifiedName,
        givenName: nameParts[0] ?? verifiedName,
        fatherName: nameParts.slice(1).join(" ") || null,
        birthDate: verifiedBirthDate,
        phoneNumber: verifiedPhone,
        phoneNormalized: normalizePhoneNumber(verifiedPhone),
        phoneVerifiedAt,
      }).where(eq(users.id, userId));
      if (Object.keys(changes).length) {
        await tx.insert(userProfileAudits).values({ adminId, targetUserId: userId, changes: JSON.stringify(changes) });
      }
      await tx.update(authPasswordCredentials).set({ phoneVerifiedAt }).where(eq(authPasswordCredentials.userId, userId));
    }
    await tx.insert(userProfileAudits).values({
      adminId,
      targetUserId: userId,
      changes: JSON.stringify({
        event: "account_verification_review",
        from: "pending",
        to: nextStatus,
        reason: decision === "reject" ? cleanReason : null,
        requestId: request.id,
      }),
    });
    return { userId, status: nextStatus, verificationMethod: decision === "approve" ? "manual" : null };
  });
}
