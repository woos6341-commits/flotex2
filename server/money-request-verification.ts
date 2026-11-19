import { eq } from "drizzle-orm";
import { appSettings } from "../drizzle/schema";
import { ACCOUNT_VERIFICATION_REQUIRED_MESSAGE, isMoneyRequestAllowedByVerification } from "../shared/account-verification-policy";
import type { getDb } from "./db";
import { readEffectiveVerificationState } from "./account-verification-state";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function assertMoneyRequestVerificationAllowed(db: Database, userId: number, role: string, type: "deposit" | "withdrawal") {
  void type;
  if (role === "admin") return;
  const [setting] = await db.select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "account_verification_required_before_money"))
    .limit(1);
  if (setting?.value !== "true") return;

  const verification = await readEffectiveVerificationState(db, userId);
  if (!isMoneyRequestAllowedByVerification(true, verification.status)) {
    throw new Error(ACCOUNT_VERIFICATION_REQUIRED_MESSAGE);
  }
}
