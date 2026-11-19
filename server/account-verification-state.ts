import { eq, inArray } from "drizzle-orm";
import {
  accountVerificationOverrides,
  accountVerifications,
  userProfileAudits,
  users,
} from "../drizzle/schema";
import { requireAdministrator } from "./payment-settings";

export type EffectiveVerificationStatus = "not_submitted" | "pending" | "approved" | "rejected";
export type ManualVerificationStatus = "manual_verified" | "revoked";

type RequestState = {
  status?: "pending" | "approved" | "rejected" | null;
  rejectionReason?: string | null;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: number | null;
};

type OverrideState = {
  status?: ManualVerificationStatus | null;
  reason?: string | null;
  updatedAt?: Date | null;
  adminId?: number | null;
};

export function resolveEffectiveVerificationState(
  override: OverrideState | null | undefined,
  request: RequestState | null | undefined,
) {
  if (override?.status === "manual_verified") {
    return {
      status: "approved" as const,
      rejectionReason: null,
      submittedAt: request?.submittedAt ?? null,
      reviewedAt: override.updatedAt ?? request?.reviewedAt ?? null,
      reviewedBy: override.adminId ?? request?.reviewedBy ?? null,
      source: "manual" as const,
    };
  }
  if (override?.status === "revoked") {
    return {
      status: "not_submitted" as const,
      rejectionReason: null,
      submittedAt: request?.submittedAt ?? null,
      reviewedAt: override.updatedAt ?? null,
      reviewedBy: override.adminId ?? null,
      source: "revoked" as const,
    };
  }
  return {
    status: request?.status ?? ("not_submitted" as const),
    rejectionReason: request?.status === "rejected" ? request.rejectionReason ?? null : null,
    submittedAt: request?.submittedAt ?? null,
    reviewedAt: request?.reviewedAt ?? null,
    reviewedBy: request?.reviewedBy ?? null,
    source: request?.status ? ("request" as const) : ("none" as const),
  };
}

export async function readEffectiveVerificationState(db: any, userId: number) {
  const [override] = await db.select({
    status: accountVerificationOverrides.status,
    reason: accountVerificationOverrides.reason,
    updatedAt: accountVerificationOverrides.updatedAt,
    adminId: accountVerificationOverrides.adminId,
  }).from(accountVerificationOverrides).where(eq(accountVerificationOverrides.userId, userId)).limit(1);
  const [request] = await db.select({
    status: accountVerifications.status,
    rejectionReason: accountVerifications.rejectionReason,
    submittedAt: accountVerifications.submittedAt,
    reviewedAt: accountVerifications.reviewedAt,
    reviewedBy: accountVerifications.reviewedBy,
  }).from(accountVerifications).where(eq(accountVerifications.userId, userId)).limit(1);
  return resolveEffectiveVerificationState(override, request);
}

export async function readEffectiveVerificationStates(db: any, userIds: number[]) {
  if (!userIds.length) return new Map<number, ReturnType<typeof resolveEffectiveVerificationState>>();
  const [overrides, requests] = await Promise.all([
    db.select({
      userId: accountVerificationOverrides.userId,
      status: accountVerificationOverrides.status,
      reason: accountVerificationOverrides.reason,
      updatedAt: accountVerificationOverrides.updatedAt,
      adminId: accountVerificationOverrides.adminId,
    }).from(accountVerificationOverrides).where(inArray(accountVerificationOverrides.userId, userIds)),
    db.select({
      userId: accountVerifications.userId,
      status: accountVerifications.status,
      rejectionReason: accountVerifications.rejectionReason,
      submittedAt: accountVerifications.submittedAt,
      reviewedAt: accountVerifications.reviewedAt,
      reviewedBy: accountVerifications.reviewedBy,
    }).from(accountVerifications).where(inArray(accountVerifications.userId, userIds)),
  ]);
  const overridesByUser = new Map<number, OverrideState>(overrides.map((row: any): [number, OverrideState] => [row.userId, row]));
  const requestsByUser = new Map<number, RequestState>(requests.map((row: any): [number, RequestState] => [row.userId, row]));
  return new Map(userIds.map((userId) => [
    userId,
    resolveEffectiveVerificationState(overridesByUser.get(userId), requestsByUser.get(userId)),
  ]));
}

export async function readEffectiveVerificationStatesForUsers(adminId: number, userIds: number[]) {
  if (!userIds.length) return new Map<number, ReturnType<typeof resolveEffectiveVerificationState>>();
  const db = await requireAdministrator(adminId);
  return readEffectiveVerificationStates(db, userIds);
}

export async function setAdminAccountVerificationStatus(
  adminId: number,
  userId: number,
  status: ManualVerificationStatus,
  reason?: string,
) {
  const cleanReason = reason?.trim() || null;
  if (cleanReason && cleanReason.length > 500) throw new Error("سبب الإجراء أطول من المسموح");
  const db = await requireAdministrator(adminId);
  return db.transaction(async (tx: any) => {
    const [user] = await tx.select({ id: users.id, role: users.role })
      .from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user) throw new Error("العميل غير موجود");
    if (user.role === "admin") throw new Error("لا يمكن تغيير حالة توثيق حساب المدير من ملف عميل");

    const now = new Date();
    const before = await readEffectiveVerificationState(tx, userId);
    const [request] = await tx.select({ id: accountVerifications.id, status: accountVerifications.status })
      .from(accountVerifications).where(eq(accountVerifications.userId, userId)).for("update").limit(1);

    if (status === "revoked") {
      if (before.status !== "approved" && before.status !== "pending") {
        throw new Error("لا يوجد اعتماد أو طلب توثيق نشط لإلغائه");
      }
      if (request?.status === "pending") {
        await tx.update(accountVerifications).set({
          status: "rejected",
          rejectionReason: cleanReason || "ألغى المدير طلب التوثيق",
          verificationMethod: null,
          reviewedBy: adminId,
          reviewedAt: now,
        }).where(eq(accountVerifications.id, request.id));
      }
    } else if (request?.status === "pending") {
      await tx.update(accountVerifications).set({
        status: "approved",
        rejectionReason: null,
        verificationMethod: "manual",
        reviewedBy: adminId,
        reviewedAt: now,
      }).where(eq(accountVerifications.id, request.id));
    }

    await tx.insert(accountVerificationOverrides).values({
      userId,
      status,
      adminId,
      reason: cleanReason,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: { status, adminId, reason: cleanReason, updatedAt: now },
    });

    const after = await readEffectiveVerificationState(tx, userId);
    await tx.insert(userProfileAudits).values({
      targetUserId: userId,
      adminId,
      changes: JSON.stringify({
        event: "account_verification_status",
        from: before.status,
        to: after.status,
        action: status,
        reason: cleanReason,
        occurredAt: now.toISOString(),
      }),
    });
    return after;
  });
}
