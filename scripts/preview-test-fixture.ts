import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { authDeviceSessions, authLoginChallenges } from "../drizzle/auth-schema";
import { authPasswordCredentials, transactions, users, wallets } from "../drizzle/schema";
import { getDb } from "../server/db";
import { hashPassword } from "../server/manual-auth-crypto";

const receipt = "/tmp/flotex-preview-test-fixture.json";
async function main() {
  if (process.env.FLOTEX_ISOLATED_TEST_DB !== "1") throw new Error("Only run on explicitly confirmed isolated test database.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (process.argv[2] === "create") {
    if ((await db.select({ id: users.id }).from(users)).length) throw new Error("Refusing fixture creation: database must be empty.");
    const id = randomUUID();
    const openId = `preview-test-${id}`;
    const email = `preview-${id}@example.test`;
    const password = `SyntheticFlotex!${id.slice(0, 8)}`;
    await db.insert(users).values({ openId, customerId: "9876543201", email, emailNormalized: email, name: "حساب اختبار مؤقت", givenName: "حساب", fatherName: "اختبار مؤقت", phoneNumber: "01098765431", phoneNormalized: "01098765431", birthDate: "1990-01-01", governorate: "القاهرة", role: "user", loginMethod: "password", profileCompletedAt: new Date() });
    const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    await db.insert(authPasswordCredentials).values({ userId: user.id, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() });
    await db.insert(wallets).values({ userId: user.id, balance: "125.50", currency: "EGP", profitLoss: "0.00" });
    await db.insert(transactions).values({ userId: user.id, reference: `PREVIEW-TEST-${id}`, type: "deposit", amount: "125.50", currency: "EGP", status: "approved", note: "بيانات اصطناعية لاختبار الواجهة فقط — ليست أموالًا حقيقية", balanceBefore: "0.00", balanceAfter: "125.50" });
    const fixture = { userId: user.id, openId, email, password, customerId: user.customerId };
    await writeFile(receipt, JSON.stringify(fixture), { mode: 0o600 });
    console.log(JSON.stringify(fixture));
  } else if (process.argv[2] === "cleanup") {
    const fixture = JSON.parse(await readFile(receipt, "utf8"));
    const [user] = await db.select().from(users).where(eq(users.id, fixture.userId)).limit(1);
    if (!user || user.openId !== fixture.openId || !user.openId.startsWith("preview-test-")) throw new Error("Fixture ownership mismatch; nothing removed.");
    await db.delete(authDeviceSessions).where(eq(authDeviceSessions.userId, user.id));
    await db.delete(authLoginChallenges).where(eq(authLoginChallenges.userId, user.id));
    await db.delete(authPasswordCredentials).where(eq(authPasswordCredentials.userId, user.id));
    await db.delete(transactions).where(eq(transactions.userId, user.id));
    await db.delete(wallets).where(eq(wallets.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
    await unlink(receipt);
    console.log("Synthetic preview fixture cleaned; users remaining:", (await db.select({ id: users.id }).from(users)).length);
  } else throw new Error("Use create or cleanup");
}
main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "Fixture failure"); process.exit(1); });
