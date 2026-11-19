import { and, desc, eq, inArray, isNull, like, ne, or } from "drizzle-orm";
import { authEmailChallenges, authPasswordCredentials } from "../drizzle/auth-schema";
import { accountVerificationOverrides, accountVerifications, appSettings, phoneVerificationRequests, userProfileAudits, users } from "../drizzle/schema";
import { ADMIN_EMAIL } from "../shared/admin";
import { isValidDateOnly } from "../shared/date-only";
import { parseEgyptianNationalId } from "../shared/national-id";
import {
  adminCustomerProfileSchema,
  canUserEditPhone,
  parseStoredPhoneVerificationContacts,
  phoneNumberSchema,
  phoneVerificationContactsSchema,
  phoneVerificationReviewSchema,
} from "../shared/phone-verification";
import { governorateSchema, normalizeEmail, normalizePhoneNumber, registrationSchema } from "../shared/registration";
import { requireAdministrator } from "./payment-settings";
import { getDb } from "./db";
import { decryptNationalId, encryptNationalId, maskNationalId } from "./profile-data";
import { fingerprintAccountVerificationValue } from "./account-verification-crypto";

const CONTACT_SETTINGS_KEY = "phone_verification_contacts";

async function readContacts(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CONTACT_SETTINGS_KEY)).limit(1);
  return parseStoredPhoneVerificationContacts(row?.value);
}

export async function getPhoneVerificationContacts() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return readContacts(db);
}

export async function updatePhoneVerificationContacts(adminId: number, input: unknown) {
  const db = await requireAdministrator(adminId);
  const contacts = phoneVerificationContactsSchema.parse(input);
  const value = JSON.stringify(contacts);
  await db.insert(appSettings).values({ key: CONTACT_SETTINGS_KEY, value, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
  return contacts;
}

export async function getMyPhoneVerification(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [user] = await db.select({
    id: users.id,
    customerId: users.customerId,
    name: users.name,
    phoneNumber: users.phoneNumber,
    phoneNormalized: users.phoneNormalized,
    phoneVerifiedAt: users.phoneVerifiedAt,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("الحساب غير موجود");
  const [latest] = await db.select({
    id: phoneVerificationRequests.id,
    phoneNormalized: phoneVerificationRequests.phoneNormalized,
    status: phoneVerificationRequests.status,
    message: phoneVerificationRequests.message,
    reviewNote: phoneVerificationRequests.reviewNote,
    createdAt: phoneVerificationRequests.createdAt,
    reviewedAt: phoneVerificationRequests.reviewedAt,
  }).from(phoneVerificationRequests)
    .where(eq(phoneVerificationRequests.userId, userId))
    .orderBy(desc(phoneVerificationRequests.createdAt), desc(phoneVerificationRequests.id))
    .limit(1);
  const request = latest && latest.phoneNormalized === user.phoneNormalized ? latest : null;
  return { ...user, request };
}

export async function updateOwnPhoneNumber(userId: number, phoneInput: string) {
  const phoneNumber = phoneNumberSchema.parse(phoneInput);
  const phoneNormalized = normalizePhoneNumber(phoneNumber);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx) => {
    const [user] = await tx.select({
      id: users.id,
      phoneNumber: users.phoneNumber,
      phoneNormalized: users.phoneNormalized,
      phoneVerifiedAt: users.phoneVerifiedAt,
    }).from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user) throw new Error("الحساب غير موجود");
    const [accountVerification] = await tx.select({ status: accountVerifications.status }).from(accountVerifications).where(eq(accountVerifications.userId, userId)).limit(1);
    const [verificationOverride] = await tx.select({ status: accountVerificationOverrides.status }).from(accountVerificationOverrides)
      .where(eq(accountVerificationOverrides.userId, userId)).limit(1);
    if (verificationOverride?.status === "manual_verified" || (verificationOverride?.status !== "revoked" && (accountVerification?.status === "pending" || accountVerification?.status === "approved"))) {
      throw new Error("لا يمكن تغيير رقم الهاتف أثناء مراجعة توثيق الحساب أو بعد اعتماده");
    }
    if (!canUserEditPhone(user.phoneVerifiedAt)) throw new Error("رقم الهاتف موثّق وثابت؛ لا يمكن تغييره من حسابك");
    if (user.phoneNormalized === phoneNormalized) return { phoneNumber: user.phoneNumber, phoneVerifiedAt: user.phoneVerifiedAt };
    const [duplicate] = await tx.select({ id: users.id }).from(users).where(eq(users.phoneNormalized, phoneNormalized)).limit(1);
    if (duplicate && duplicate.id !== userId) throw new Error("رقم الهاتف مرتبط بحساب آخر");
    const updated = await tx.update(users).set({ phoneNumber, phoneNormalized })
      .where(and(eq(users.id, userId), isNull(users.phoneVerifiedAt))) as any;
    const affected = Number(updated?.[0]?.affectedRows ?? updated?.affectedRows ?? 0);
    if (affected !== 1) throw new Error("تعذر حفظ الرقم؛ أعد تحميل الملف وحاول مجددًا");
    await tx.update(phoneVerificationRequests).set({ status: "cancelled", reviewedAt: new Date(), reviewNote: "أُلغي الطلب لأن المستخدم غيّر رقم الهاتف قبل المراجعة" })
      .where(and(eq(phoneVerificationRequests.userId, userId), eq(phoneVerificationRequests.status, "pending"), ne(phoneVerificationRequests.phoneNormalized, phoneNormalized)));
    const [saved] = await tx.select({ phoneNumber: users.phoneNumber, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
    return saved;
  });
}

export async function submitMyPhoneVerificationRequest(userId: number, message: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const cleanMessage = message.trim().slice(0, 500);
  return db.transaction(async (tx) => {
    const [user] = await tx.select({
      id: users.id,
      phoneNumber: users.phoneNumber,
      phoneNormalized: users.phoneNormalized,
      phoneVerifiedAt: users.phoneVerifiedAt,
    }).from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user) throw new Error("الحساب غير موجود");
    if (!user.phoneNumber || !user.phoneNormalized) throw new Error("أضف رقم هاتف صالحًا إلى ملفك أولًا");
    if (user.phoneVerifiedAt) throw new Error("هذا الرقم موثّق بالفعل");
    const [existing] = await tx.select().from(phoneVerificationRequests)
      .where(and(eq(phoneVerificationRequests.userId, userId), eq(phoneVerificationRequests.phoneNormalized, user.phoneNormalized), eq(phoneVerificationRequests.status, "pending")))
      .orderBy(desc(phoneVerificationRequests.createdAt), desc(phoneVerificationRequests.id)).limit(1);
    if (existing) return { id: existing.id, status: existing.status, createdAt: existing.createdAt };
    const [oldPending] = await tx.select({ id: phoneVerificationRequests.id }).from(phoneVerificationRequests)
      .where(and(eq(phoneVerificationRequests.userId, userId), eq(phoneVerificationRequests.status, "pending"))).limit(1);
    if (oldPending) await tx.update(phoneVerificationRequests).set({ status: "cancelled", reviewedAt: new Date(), reviewNote: "أُلغي الطلب السابق بعد تغيير الرقم" }).where(eq(phoneVerificationRequests.id, oldPending.id));
    const inserted = await tx.insert(phoneVerificationRequests).values({
      userId,
      phoneNumber: user.phoneNumber,
      phoneNormalized: user.phoneNormalized,
      message: cleanMessage || null,
      status: "pending",
    }) as any;
    const id = Number(inserted?.[0]?.insertId ?? inserted?.insertId ?? 0);
    const [created] = await tx.select({ id: phoneVerificationRequests.id, status: phoneVerificationRequests.status, createdAt: phoneVerificationRequests.createdAt })
      .from(phoneVerificationRequests).where(and(eq(phoneVerificationRequests.userId, userId), eq(phoneVerificationRequests.phoneNormalized, user.phoneNormalized), eq(phoneVerificationRequests.status, "pending")))
      .orderBy(desc(phoneVerificationRequests.id)).limit(1);
    return created ?? { id, status: "pending" as const, createdAt: new Date() };
  });
}

export async function listPhoneVerificationUsers(adminId: number, rawSearch: string) {
  const db = await requireAdministrator(adminId);
  const search = rawSearch.trim().replace(/[%_]/g, " ").trim();
  const normalized = search ? normalizePhoneNumber(search) : "";
  const filters = search ? or(
    like(users.customerId, `%${search}%`),
    like(users.name, `%${search}%`),
    like(users.givenName, `%${search}%`),
    like(users.fatherName, `%${search}%`),
    like(users.phoneNumber, `%${search}%`),
    ...(normalized ? [like(users.phoneNormalized, `%${normalized}%`)] : []),
  ) : undefined;
  const rows = await db.select({
    id: users.id,
    customerId: users.customerId,
    name: users.name,
    email: users.email,
    givenName: users.givenName,
    fatherName: users.fatherName,
    phoneNumber: users.phoneNumber,
    phoneNormalized: users.phoneNormalized,
    phoneVerifiedAt: users.phoneVerifiedAt,
    profileCompletedAt: users.profileCompletedAt,
    role: users.role,
  }).from(users).where(filters).orderBy(desc(users.createdAt)).limit(50);
  if (!rows.length) return [];
  const requests = await db.select().from(phoneVerificationRequests)
    .where(inArray(phoneVerificationRequests.userId, rows.map((row) => row.id)))
    .orderBy(desc(phoneVerificationRequests.createdAt), desc(phoneVerificationRequests.id));
  const latestRequest = new Map<number, typeof requests[number]>();
  for (const request of requests) if (!latestRequest.has(request.userId)) latestRequest.set(request.userId, request);
  return rows.map((row) => {
    const candidate = latestRequest.get(row.id);
    const request = candidate?.phoneNormalized === row.phoneNormalized ? candidate ?? null : null;
    return { ...row, request };
  });
}

export async function listUserProfileAudits(adminId: number, targetUserId: number) {
  const db = await requireAdministrator(adminId);
  const logs = await db.select().from(userProfileAudits)
    .where(eq(userProfileAudits.targetUserId, targetUserId))
    .orderBy(desc(userProfileAudits.createdAt), desc(userProfileAudits.id)).limit(50);
  if (!logs.length) return [];
  const adminIds = [...new Set(logs.map((log) => log.adminId))];
  const admins = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, adminIds));
  const adminMap = new Map(admins.map((admin) => [admin.id, admin]));
  return logs.map((log) => ({ ...log, admin: adminMap.get(log.adminId) ?? null }));
}

export async function updateCustomerProfileByAdmin(adminId: number, rawInput: unknown) {
  const db = await requireAdministrator(adminId);
  const input = adminCustomerProfileSchema.parse(rawInput);
  const phoneNumber = input.phoneNumber === undefined ? undefined : phoneNumberSchema.parse(input.phoneNumber);
  const phoneNormalized = phoneNumber === undefined ? undefined : normalizePhoneNumber(phoneNumber);
  const nationalId = input.nationalId === undefined ? undefined : parseEgyptianNationalId(input.nationalId);
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for("update").limit(1);
    if (!user) throw new Error("حساب العميل غير موجود");
    if (user.role === "admin") throw new Error("لا يمكن تعديل بيانات حساب المدير من هذه الأداة");
    if (phoneNormalized) {
      const [duplicate] = await tx.select({ id: users.id }).from(users).where(eq(users.phoneNormalized, phoneNormalized)).limit(1);
      if (duplicate && duplicate.id !== user.id) throw new Error("رقم الهاتف مرتبط بحساب آخر");
    }
    const email = input.email === undefined ? undefined : normalizeEmail(input.email);
    if (email && email !== user.emailNormalized) {
      if (email === ADMIN_EMAIL) throw new Error("لا يمكن تعيين بريد الإدارة الأساسي لملف عميل");
      const [duplicate] = await tx.select({ id: users.id }).from(users).where(eq(users.emailNormalized, email)).limit(1);
      if (duplicate && duplicate.id !== user.id) throw new Error("البريد الإلكتروني مرتبط بحساب آخر");
    }
    if (nationalId !== undefined) {
      const fingerprint = fingerprintAccountVerificationValue("national-id", nationalId);
      const [duplicateUser] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.nationalIdFingerprint, fingerprint), ne(users.id, user.id))).limit(1);
      if (duplicateUser) throw new Error("الرقم القومي مرتبط بحساب آخر");
      const [duplicate] = await tx.select({ userId: accountVerifications.userId }).from(accountVerifications)
        .where(eq(accountVerifications.nationalIdFingerprint, fingerprint)).limit(1);
      if (duplicate && duplicate.userId !== user.id) throw new Error("الرقم القومي مرتبط بطلب توثيق لحساب آخر");
    }

    let givenName = input.givenName === undefined ? user.givenName : input.givenName.trim().replace(/\s+/g, " ");
    let fatherName = input.fatherName === undefined ? user.fatherName : input.fatherName.trim().replace(/\s+/g, " ");
    if (input.fullName !== undefined) {
      const fullName = input.fullName.trim().replace(/\s+/g, " ");
      const parts = fullName.split(" ");
      if (parts.length < 2) throw new Error("أدخل الاسم كاملًا مكوّنًا من اسمين على الأقل");
      givenName = registrationSchema.shape.givenName.parse(parts[0]);
      fatherName = registrationSchema.shape.fatherName.parse(parts.slice(1).join(" "));
    }
    const name = input.fullName !== undefined || input.givenName !== undefined || input.fatherName !== undefined
      ? [givenName, fatherName].filter(Boolean).join(" ") || user.name
      : user.name;
    const phoneChanged = phoneNumber !== undefined && user.phoneNormalized !== phoneNormalized;
    let currentNationalId: string | null = null;
    if (user.nationalIdCiphertext) {
      try { currentNationalId = decryptNationalId(user.nationalIdCiphertext); }
      catch { throw new Error("تعذر فك تشفير الرقم القومي الحالي؛ لم يتم حفظ أي تعديل"); }
    }
    const nationalIdChanged = nationalId !== undefined && nationalId !== currentNationalId;
    const birthDate = input.birthDate === undefined ? undefined : input.birthDate;
    if (birthDate !== undefined && !isValidDateOnly(birthDate)) throw new Error("تاريخ الميلاد غير صالح");
    const governorate = input.governorate === undefined ? undefined : governorateSchema.parse(input.governorate);
    const emailChanged = email !== undefined && email !== user.emailNormalized;
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if ((user.givenName ?? "") !== (givenName ?? "")) changes.givenName = { from: user.givenName, to: givenName };
    if ((user.fatherName ?? "") !== (fatherName ?? "")) changes.fatherName = { from: user.fatherName, to: fatherName };
    if ((user.name ?? "") !== (name ?? "")) changes.name = { from: user.name, to: name };
    if (phoneNumber !== undefined && (user.phoneNumber ?? "") !== phoneNumber) changes.phoneNumber = { from: user.phoneNumber, to: phoneNumber };
    if (phoneChanged && user.phoneVerifiedAt) changes.phoneVerifiedAt = { from: user.phoneVerifiedAt.toISOString(), to: null };
    if (emailChanged) changes.email = { from: user.email ?? null, to: email ?? null };
    if (birthDate !== undefined && (user.birthDate ?? "") !== birthDate) changes.birthDate = { from: user.birthDate ?? null, to: birthDate };
    if (governorate !== undefined && (user.governorate ?? "") !== governorate) changes.governorate = { from: user.governorate ?? null, to: governorate };
    if (nationalIdChanged) {
      changes.nationalId = { from: maskNationalId(user.nationalIdLast4), to: maskNationalId(nationalId?.slice(-4)) };
    }
    if (!Object.keys(changes).length) return {
      success: true,
      userId: user.id,
      phoneChanged: false,
      nationalIdChanged: false,
      name: user.name,
      givenName: user.givenName,
      fatherName: user.fatherName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      birthDate: user.birthDate,
      governorate: user.governorate,
      phoneVerifiedAt: user.phoneVerifiedAt,
      nationalIdMasked: maskNationalId(user.nationalIdLast4),
    };

    const now = new Date();
    await tx.update(users).set({
      ...((input.fullName !== undefined || input.givenName !== undefined) ? { givenName } : {}),
      ...((input.fullName !== undefined || input.fatherName !== undefined) ? { fatherName } : {}),
      ...(name !== user.name ? { name } : {}),
      ...(phoneNumber !== undefined ? { phoneNumber, phoneNormalized } : {}),
      ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
      ...(emailChanged ? { email, emailNormalized: email } : {}),
      ...(birthDate !== undefined ? { birthDate } : {}),
      ...(governorate !== undefined ? { governorate } : {}),
      ...(nationalIdChanged && nationalId ? { nationalIdCiphertext: encryptNationalId(nationalId), nationalIdLast4: nationalId.slice(-4), nationalIdFingerprint: fingerprintAccountVerificationValue("national-id", nationalId) } : {}),
    }).where(eq(users.id, user.id));
    if (emailChanged) {
      await tx.update(authEmailChallenges).set({ codeConsumedAt: now, grantConsumedAt: now })
        .where(eq(authEmailChallenges.userId, user.id));
    }
    if (phoneChanged) {
      await tx.update(authPasswordCredentials).set({ phoneVerifiedAt: null }).where(eq(authPasswordCredentials.userId, user.id));
      await tx.update(phoneVerificationRequests).set({ status: "cancelled", reviewedAt: now, reviewedBy: adminId, reviewNote: "أُلغي الطلب بعد تعديل المدير لرقم الهاتف" })
        .where(and(eq(phoneVerificationRequests.userId, user.id), eq(phoneVerificationRequests.status, "pending")));
    }

    const [verification] = await tx.select().from(accountVerifications)
      .where(eq(accountVerifications.userId, user.id)).for("update").limit(1);
    if (nationalIdChanged && verification?.status === "pending") {
      await tx.update(accountVerifications).set({
        status: "rejected",
        rejectionReason: "تم تحديث الرقم القومي من الإدارة. أعد إرسال مستندات الهوية المطابقة.",
        verificationMethod: null,
        reviewedBy: adminId,
        reviewedAt: now,
      }).where(eq(accountVerifications.id, verification.id));
      changes.accountVerification = { from: "pending", to: "rejected" };
    }
    if (nationalIdChanged) {
      const [override] = await tx.select({ status: accountVerificationOverrides.status })
        .from(accountVerificationOverrides).where(eq(accountVerificationOverrides.userId, user.id)).for("update").limit(1);
      if (verification?.status === "approved" || override?.status === "manual_verified") {
        await tx.insert(accountVerificationOverrides).values({
          userId: user.id,
          status: "revoked",
          adminId,
          reason: "أُلغي التوثيق بعد تحديث الرقم القومي، ويلزم التحقق من مستندات الهوية الجديدة.",
          updatedAt: now,
        }).onDuplicateKeyUpdate({
          set: { status: "revoked", adminId, reason: "أُلغي التوثيق بعد تحديث الرقم القومي، ويلزم التحقق من مستندات الهوية الجديدة.", updatedAt: now },
        });
        changes.accountVerification = { from: "approved", to: "not_submitted" };
      }
    }
    if (verification?.status === "pending" && !nationalIdChanged) {
      const pendingChanges: Record<string, unknown> = {};
      if (name !== user.name) pendingChanges.nameSnapshot = name;
      if (emailChanged) pendingChanges.emailSnapshot = email;
      if (birthDate !== undefined) pendingChanges.birthDateSnapshot = birthDate;
      if (phoneNumber !== undefined) pendingChanges.phoneNumberSnapshot = phoneNumber;
      if (phoneChanged && phoneNormalized) pendingChanges.phoneFingerprint = fingerprintAccountVerificationValue("phone", phoneNormalized);
      if (Object.keys(pendingChanges).length) {
        await tx.update(accountVerifications).set(pendingChanges).where(eq(accountVerifications.id, verification.id));
      }
    }
    await tx.insert(userProfileAudits).values({ adminId, targetUserId: user.id, changes: JSON.stringify(changes) });
    const [saved] = await tx.select({ phoneNumber: users.phoneNumber, phoneVerifiedAt: users.phoneVerifiedAt, givenName: users.givenName, fatherName: users.fatherName, name: users.name, email: users.email, birthDate: users.birthDate, governorate: users.governorate })
      .from(users).where(eq(users.id, user.id)).limit(1);
    return {
      success: true,
      userId: user.id,
      phoneChanged,
      nationalIdChanged,
      nationalIdMasked: maskNationalId(nationalIdChanged ? nationalId?.slice(-4) : user.nationalIdLast4),
      ...saved,
    };
  });
}

export async function getAdminCustomerNationalId(adminId: number, userId: number) {
  const db = await requireAdministrator(adminId);
  const [user] = await db.select({ nationalIdCiphertext: users.nationalIdCiphertext, nationalIdLast4: users.nationalIdLast4, role: users.role })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.role === "admin") throw new Error("حساب العميل غير موجود أو غير متاح");
  if (!user.nationalIdCiphertext) return { nationalId: null, nationalIdMasked: maskNationalId(user.nationalIdLast4) };
  try {
    const nationalId = decryptNationalId(user.nationalIdCiphertext);
    return { nationalId, nationalIdMasked: maskNationalId(user.nationalIdLast4) };
  } catch {
    throw new Error("تعذر قراءة الرقم القومي المشفر؛ لا يمكن عرض بيانات غير موثوقة");
  }
}

export async function reviewPhoneVerificationRequest(adminId: number, rawInput: unknown) {
  const db = await requireAdministrator(adminId);
  const input = phoneVerificationReviewSchema.parse(rawInput);
  const [requestSnapshot] = await db.select({ userId: phoneVerificationRequests.userId }).from(phoneVerificationRequests)
    .where(eq(phoneVerificationRequests.id, input.requestId)).limit(1);
  if (!requestSnapshot) throw new Error("طلب التوثيق غير موجود");
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, phoneNormalized: users.phoneNormalized, phoneVerifiedAt: users.phoneVerifiedAt })
      .from(users).where(eq(users.id, requestSnapshot.userId)).for("update").limit(1);
    const [request] = await tx.select().from(phoneVerificationRequests).where(eq(phoneVerificationRequests.id, input.requestId)).for("update").limit(1);
    if (!user || !request) throw new Error("الحساب أو طلب التوثيق غير موجود");
    if (request.status !== "pending") throw new Error("سبق مراجعة طلب التوثيق أو إلغاؤه");
    if (!user.phoneNormalized || request.phoneNormalized !== user.phoneNormalized) throw new Error("تغير رقم الهاتف؛ لا يمكن اعتماد هذا الطلب القديم");
    if (input.status === "approved") {
      if (!input.ownershipConfirmed) throw new Error("لا يمكن التوثيق قبل تأكيد مراجعة ملكية الرقم");
      if (user.phoneVerifiedAt) throw new Error("رقم الهاتف موثّق بالفعل");
      const verifiedAt = new Date();
      const updated = await tx.update(users).set({ phoneVerifiedAt: verifiedAt })
        .where(and(eq(users.id, user.id), eq(users.phoneNormalized, request.phoneNormalized), isNull(users.phoneVerifiedAt))) as any;
      const affected = Number(updated?.[0]?.affectedRows ?? updated?.affectedRows ?? 0);
      if (affected !== 1) throw new Error("تغيرت حالة الهاتف قبل اعتمادها؛ أعد تحميل الطلب");
      await tx.update(authPasswordCredentials).set({ phoneVerifiedAt: verifiedAt }).where(eq(authPasswordCredentials.userId, user.id));
      await tx.update(phoneVerificationRequests).set({ status: "approved", reviewedBy: adminId, reviewedAt: verifiedAt, reviewNote: input.note || "تم التحقق من ملكية الرقم يدويًا" }).where(eq(phoneVerificationRequests.id, request.id));
      await tx.insert(userProfileAudits).values({ adminId, targetUserId: user.id, changes: JSON.stringify({ phoneVerifiedAt: { from: null, to: verifiedAt.toISOString() }, phoneNumber: { from: request.phoneNumber, to: request.phoneNumber } }) });
      return { success: true, status: "approved" as const, phoneVerifiedAt: verifiedAt };
    }
    const reviewedAt = new Date();
    await tx.update(phoneVerificationRequests).set({ status: "rejected", reviewedBy: adminId, reviewedAt, reviewNote: input.note }).where(eq(phoneVerificationRequests.id, request.id));
    return { success: true, status: "rejected" as const, phoneVerifiedAt: user.phoneVerifiedAt };
  });
}
