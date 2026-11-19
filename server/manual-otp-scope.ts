import { and, eq, gt, isNull, notExists, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { authEmailChallenges } from "../drizzle/auth-schema";
import { manualVerificationCodes } from "../drizzle/manual-verification-schema";
import { appSettings } from "../drizzle/schema";

type OtpPurpose = "register" | "password_reset" | "account_support" | "guest_support";

/** Must be acquired first in the issuance transaction, including when the scope is empty. */
export async function lockOtpScope(tx: any, email: string, purpose: OtpPurpose, secret: string) {
  // Preserve the existing manual-issuance namespace so old and new servers share a lock.
  const key = `manualotp:${createHmac("sha256", secret).update(`${email}\0${purpose}`).digest("hex")}`;
  await tx.insert(appSettings).values({ key, value: "" }).onDuplicateKeyUpdate({ set: { updatedAt: sql`CURRENT_TIMESTAMP` } });
  await tx.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, key)).for("update").limit(1);
}

/** Called under the scope lock, in the same transaction as the replacement insert. */
export async function invalidatePreviousOtpIssues(
  tx: any, email: string, purpose: OtpPurpose, now: Date,
  actor: { id: number; name: string } | null,
) {
  // Grant consumers lock challenge -> manual audit row. Leave manual challenges alone
  // and revoke their audit row instead, preserving that order and the existing guard.
  const manualRow = tx.select({ id: manualVerificationCodes.id }).from(manualVerificationCodes)
    .where(eq(manualVerificationCodes.id, authEmailChallenges.id));
  await tx.update(authEmailChallenges).set({
    codeConsumedAt: sql`COALESCE(${authEmailChallenges.codeConsumedAt}, ${now})`,
    grantConsumedAt: sql`COALESCE(${authEmailChallenges.grantConsumedAt}, ${now})`,
  }).where(and(eq(authEmailChallenges.email, email), eq(authEmailChallenges.purpose, purpose), notExists(manualRow)));

  if (purpose === "register" || purpose === "password_reset") {
    // A used manual code may still have an unspent grant; revoking the audit row
    // makes the existing manualGrantAllowed check reject it as well.
    await tx.update(manualVerificationCodes).set({
      revokedAt: now,
      revokedBy: actor?.id ?? null,
      revokedByName: actor?.name ?? null,
      revokeReason: "replacement",
    }).where(and(
      eq(manualVerificationCodes.email, email), eq(manualVerificationCodes.purpose, purpose),
      isNull(manualVerificationCodes.revokedAt), isNull(manualVerificationCodes.lockedAt),
      gt(manualVerificationCodes.expiresAt, now),
    ));
  }
}
