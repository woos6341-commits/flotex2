import { eq } from "drizzle-orm";
import { adminCreatedAccounts } from "../drizzle/admin-created-accounts-schema";
import { accountVerifications, users } from "../drizzle/schema";
import { normalizeEmail, normalizePhoneNumber } from "../shared/registration";
import { readEffectiveVerificationState } from "./account-verification-state";

/**
 * Integration REQUIRED: call within the money operation's transaction with the user row locked,
 * on all debit/credit/transfer and administrative money paths, before any financial write.
 * The application currently does NOT call this helper. Ordinary non-staged users are unaffected.
 */
export async function assertAdminCreatedAccountFinancialAllowed(tx: any, userId: number): Promise<void> {
  const [staged] = await tx.select().from(adminCreatedAccounts).where(eq(adminCreatedAccounts.userId, userId)).limit(1);
  if (!staged) return;
  const deny = () => { throw new Error("يلزم إكمال توثيق الهوية ومطابقته لبيانات الحساب قبل أي خدمة مالية."); };
  if (staged.state !== "active" || !staged.emailVerifiedAt || !staged.identityReviewedAt || !staged.identityEvidenceRef) return deny();
  const [user] = await tx.select({ status: users.status, name: users.name, email: users.email, emailNormalized: users.emailNormalized, phoneNumber: users.phoneNumber, phoneNormalized: users.phoneNormalized, birthDate: users.birthDate, profileCompletedAt: users.profileCompletedAt, nationalIdFingerprint: users.nationalIdFingerprint }).from(users).where(eq(users.id, userId)).limit(1);
  const [verification] = await tx.select({ status: accountVerifications.status, name: accountVerifications.nameSnapshot, email: accountVerifications.emailSnapshot, phone: accountVerifications.phoneNumberSnapshot, birthDate: accountVerifications.birthDateSnapshot, nationalIdFingerprint: accountVerifications.nationalIdFingerprint }).from(accountVerifications).where(eq(accountVerifications.userId, userId)).limit(1);
  const effective = await readEffectiveVerificationState(tx, userId);
  if (!user || user.status !== "active" || !user.profileCompletedAt || !verification || verification.status !== "approved" || effective.status !== "approved" || !user.name || user.name.trim() !== verification.name.trim() || !user.email || normalizeEmail(user.email) !== normalizeEmail(staged.email) || normalizeEmail(user.emailNormalized ?? "") !== normalizeEmail(staged.email) || !verification.email || normalizeEmail(verification.email) !== normalizeEmail(staged.email) || !user.phoneNumber || !user.phoneNormalized || normalizePhoneNumber(user.phoneNumber) !== user.phoneNormalized || normalizePhoneNumber(verification.phone) !== user.phoneNormalized || !user.birthDate || user.birthDate !== verification.birthDate || !user.nationalIdFingerprint || user.nationalIdFingerprint !== verification.nationalIdFingerprint) return deny();
}
