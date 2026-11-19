import { eq } from "drizzle-orm";
import { manualVerificationCodes } from "../drizzle/manual-verification-schema";
import { ADMIN_EMAIL } from "../shared/admin";

/** Ordinary email challenges are unchanged. Manual grants must remain within their audited scope. */
export async function manualGrantAllowed(tx: any, challenge: any, target?: { id: number; role: string; status: string } | null): Promise<boolean> {
  const [row] = await tx.select().from(manualVerificationCodes).where(eq(manualVerificationCodes.id, challenge.id)).for("update").limit(1);
  if (!row) return true;
  if (!row.usedAt || row.revokedAt || row.lockedAt || row.email === ADMIN_EMAIL || row.email !== challenge.email ||
      row.purpose !== challenge.purpose || row.userId !== challenge.userId || row.phoneNormalized !== challenge.phoneNormalized) return false;
  if (row.purpose === "register") return !target && row.userId === null;
  if (target === undefined) return row.userId !== null;
  return Boolean(target && target.id === row.userId && target.role === "user" && target.status === "active");
}
