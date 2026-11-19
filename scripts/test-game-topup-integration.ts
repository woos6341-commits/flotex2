import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { gameTopupFundingEntries, gameTopupRequests, gameTopupSettings, notifications, transactions, users, wallets } from "../drizzle/schema";
import { getDb } from "../server/db";
import { cancelGameTopupRequest, createGameTopupRequest, getAdminGameTopupCatalog, getGameTopupCatalog, getGameTopupOverview, listAdminGameTopupRequests, listMyGameTopupRequests, reviewGameTopupRequest } from "../server/game-topup";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const stamp = Date.now();
  const openId = `test-gt-${stamp}`;
  const customerId = String(7000000000 + randomInt(0, 999999999));
  const email = `game-topup-test-${stamp}@example.invalid`;

  const [settingsBefore] = await db.select().from(gameTopupSettings).where(eq(gameTopupSettings.id, 1)).limit(1);
  const fundingBefore = settingsBefore?.fundingBalance ?? "0.00";

  const insertedUser: any = await db.insert(users).values({
    openId,
    customerId,
    name: "عميل اختبار شحن الألعاب",
    email,
    emailNormalized: email,
    profileCompletedAt: new Date(),
    role: "user",
    status: "active",
  });
  const userId = Number(insertedUser?.[0]?.insertId ?? insertedUser?.insertId);
  assert.ok(userId > 0, "test user created");
  await db.insert(wallets).values({ userId, balance: "1000.00", currency: "EGP" });

  try {
    const catalog = await getGameTopupCatalog();
    assert.equal(catalog.enabled, true);
    assert.equal(catalog.games.length >= 3, true, "default games seeded");
    const fee = Number(catalog.fee.amount);
    assert.equal(fee > 0, true, "service fee is enabled by default");
    console.log(`✓ catalog seeded: ${catalog.games.length} games, fee=${fee} EGP`);

    const pubg = catalog.games.find((game) => game.slug === "pubg-mobile");
    const freeFire = catalog.games.find((game) => game.slug === "free-fire");
    const legends = catalog.games.find((game) => game.slug === "mobile-legends");
    assert.ok(pubg && freeFire && legends, "default games present");

    const package30 = pubg!.packages.find((item) => item.quantity === 30) ?? pubg!.packages[0];
    const first = await createGameTopupRequest(userId, {
      gameId: pubg!.id,
      packageId: package30.id,
      fields: { playerId: "5123456789", playerName: "TestPlayer" },
      idempotencyKey: `GT-TEST-${stamp}-A1`,
    });
    assert.equal(first.duplicate, false);
    assert.equal(Number(first.request.subtotalAmount), Number(package30.price));
    assert.equal(Number(first.request.feeAmount), fee);
    assert.equal(Number(first.request.totalAmount), Number(package30.price) + fee);
    let overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.reservedOrders), Number(first.request.totalAmount));
    assert.equal(Number(overview.wallet.available), 1000 - Number(first.request.totalAmount));
    console.log(`✓ hold created: subtotal=${first.request.subtotalAmount}, fee=${first.request.feeAmount}, total=${first.request.totalAmount}`);

    const duplicate = await createGameTopupRequest(userId, {
      gameId: pubg!.id,
      packageId: package30.id,
      fields: { playerId: "5123456789", playerName: "TestPlayer" },
      idempotencyKey: `GT-TEST-${stamp}-A1`,
    });
    assert.equal(duplicate.duplicate, true);
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.reservedOrders), Number(first.request.totalAmount), "no double hold");
    assert.equal(overview.requests.length, 1);
    console.log("✓ idempotent retry does not double-hold");

    const approved = await reviewGameTopupRequest(userId, { requestId: first.request.id, status: "approved" });
    assert.equal(approved.request.status, "approved");
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.balance), 1000 - Number(first.request.totalAmount));
    assert.equal(Number(overview.wallet.reservedOrders), 0);
    const [firstTx] = await db.select().from(transactions).where(eq(transactions.reference, `GT-TX-${first.request.reference}`)).limit(1);
    assert.ok(firstTx, "wallet transaction recorded");
    assert.equal(Number(firstTx!.amount), Number(first.request.totalAmount));
    console.log("✓ approval debits wallet once and records transaction");

    const second = await createGameTopupRequest(userId, {
      gameId: freeFire!.id,
      quantity: 100,
      fields: { playerId: "123456789", playerName: "FFPlayer" },
      idempotencyKey: `GT-TEST-${stamp}-B2`,
    });
    assert.equal(Number(second.request.totalAmount), 60 + fee);
    const cancelled = await cancelGameTopupRequest(userId, second.request.id);
    assert.equal(cancelled.request.status, "cancelled");
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.reservedOrders), 0);
    console.log("✓ cancellation releases the hold without charging");

    const third = await createGameTopupRequest(userId, {
      gameId: legends!.id,
      packageId: legends!.packages[0].id,
      fields: { playerId: "MLBB-7788", playerName: "LegendPlayer" },
      idempotencyKey: `GT-TEST-${stamp}-C3`,
    });
    const rejected = await reviewGameTopupRequest(userId, { requestId: third.request.id, status: "rejected", rejectionReason: "بيانات اللاعب غير صحيحة" });
    assert.equal(rejected.request.status, "rejected");
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.reservedOrders), 0);
    assert.equal(Number(overview.wallet.balance), 1000 - Number(first.request.totalAmount));
    console.log("✓ rejection releases the hold without charging");

    const fourth = await createGameTopupRequest(userId, {
      gameId: pubg!.id,
      quantity: 60,
      fields: { playerId: "5123456789", playerName: "TestPlayer" },
      idempotencyKey: `GT-TEST-${stamp}-D4`,
    });
    await reviewGameTopupRequest(userId, { requestId: fourth.request.id, status: "approved" });
    await reviewGameTopupRequest(userId, { requestId: fourth.request.id, status: "processing" });
    const completed = await reviewGameTopupRequest(userId, { requestId: fourth.request.id, status: "completed", providerReference: "PROVIDER-REF-123" });
    assert.equal(completed.request.status, "completed");
    assert.equal(completed.request.providerReference, "PROVIDER-REF-123");
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.balance), 1000 - Number(first.request.totalAmount) - Number(fourth.request.totalAmount));
    console.log("✓ processing and completion keep a single debit");

    const adminCatalog = await getAdminGameTopupCatalog();
    const expectedFunding = Number(fundingBefore) + Number(first.request.totalAmount) + Number(fourth.request.totalAmount);
    assert.equal(Number(adminCatalog.settings.fundingBalance), expectedFunding, "funding wallet includes subtotal + fee");
    assert.equal(Number(adminCatalog.feesCollected) >= fee * 2, true, "fees are reported separately");
    const adminList = await listAdminGameTopupRequests({ status: "all", search: first.request.reference });
    assert.equal(adminList.requests.length, 1);
    assert.equal(adminList.requests[0].customerId, customerId);
    console.log(`✓ funding wallet=${adminCatalog.settings.fundingBalance}, fees collected=${adminCatalog.feesCollected}`);

    await assert.rejects(() => createGameTopupRequest(userId, {
      gameId: freeFire!.id,
      quantity: 1,
      fields: { playerId: "x", playerName: "y" },
      idempotencyKey: `GT-TEST-${stamp}-E5`,
    }), /أقل كمية/);
    await assert.rejects(() => createGameTopupRequest(userId, {
      gameId: pubg!.id,
      quantity: 5000,
      fields: { playerId: "x", playerName: "y" },
      idempotencyKey: `GT-TEST-${stamp}-F6`,
    }), /غير كاف/);
    console.log("✓ validation rejects below-minimum quantity and insufficient balance");

    const mine = await listMyGameTopupRequests(userId);
    assert.equal(mine.length, 4);
    console.log("✓ customer history returns all four requests");
    console.log("\nALL GAME TOP-UP INTEGRATION TESTS PASSED");
  } finally {
    await db.delete(gameTopupFundingEntries).where(like(gameTopupFundingEntries.operationId, `game-topup:GT-%`));
    const rows = await db.select({ id: gameTopupRequests.id }).from(gameTopupRequests).where(eq(gameTopupRequests.userId, userId));
    if (rows.length) {
      const ids = rows.map((row) => row.id);
      await db.delete(gameTopupFundingEntries).where(inArray(gameTopupFundingEntries.requestId, ids));
      await db.delete(gameTopupRequests).where(eq(gameTopupRequests.userId, userId));
    }
    await db.delete(transactions).where(and(eq(transactions.userId, userId), like(transactions.reference, "GT-TX-%")));
    await db.delete(notifications).where(eq(notifications.userId, userId));
    await db.delete(wallets).where(eq(wallets.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await db.update(gameTopupSettings).set({ fundingBalance: fundingBefore }).where(eq(gameTopupSettings.id, 1));
    console.log("cleanup complete; test user and requests removed");
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("TEST FAILED", error);
  process.exit(1);
});
