import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { gameTopupFundingEntries, gameTopupGames, gameTopupRequests, gameTopupSettings, notifications, transactions, users, wallets } from "../drizzle/schema";
import { getDb } from "../server/db";
import {
  cancelGameTopupRequest,
  createGameDepositRequest,
  createGameWithdrawRequest,
  getGameTopupCatalog,
  getGameTopupOverview,
  reviewGameTopupRequest,
  saveGameTopupGame,
} from "../server/game-topup";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const stamp = Date.now();
  const openId = `test-gs-${stamp}`;
  const customerId = String(7100000000 + randomInt(0, 999999999));
  const email = `game-service-test-${stamp}@example.invalid`;
  const [settingsBefore] = await db.select().from(gameTopupSettings).where(eq(gameTopupSettings.id, 1)).limit(1);
  const fundingBefore = settingsBefore?.fundingBalance ?? "0.00";
  const catalogBefore = await getGameTopupCatalog();
  const service = catalogBefore.games.find((game) => game.slug === "1xbet");
  assert.ok(service, "1xBet service must be seeded");
  const [gameBefore] = await db.select().from(gameTopupGames).where(eq(gameTopupGames.id, service!.id)).limit(1);
  assert.ok(gameBefore, "1xBet row exists");
  const insertedUser: any = await db.insert(users).values({
    openId,
    customerId,
    name: "عميل اختبار 1xBet",
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
    await saveGameTopupGame(90001, {
      id: service!.id,
      slug: service!.slug,
      name: service!.name,
      serviceType: "deposit_withdraw",
      currencyLabel: service!.currencyLabel,
      minQuantity: service!.minQuantity,
      unitPrice: service!.unitPrice,
      fields: service!.fields,
      sortOrder: service!.sortOrder,
      isActive: true,
      depositFeeEnabled: true,
      depositFeeAmount: "10.00",
      depositFeeMin: "0.00",
      depositFeeMax: "100.00",
      minDepositAmount: "50.00",
      minWithdrawAmount: "50.00",
      withdrawEnabled: true,
      cityValue: "مدينة اختبار ثابتة",
      streetValue: "شارع اختبار ثابت",
      withdrawalInstructions: "تعليمات سحب محدثة من لوحة الإدارة\nخطوة ثانية قابلة للتغيير",
    });
    const refreshedCatalog = await getGameTopupCatalog();
    const refreshedService = refreshedCatalog.games.find((game) => game.id === service!.id);
    assert.equal(refreshedService?.cityValue, "مدينة اختبار ثابتة");
    assert.equal(refreshedService?.streetValue, "شارع اختبار ثابت");
    assert.equal(refreshedService?.withdrawalInstructions, "تعليمات سحب محدثة من لوحة الإدارة\nخطوة ثانية قابلة للتغيير");
    console.log("✓ admin can save fixed address text and multiline guide; latest values return in the customer catalog");

    await assert.rejects(() => createGameDepositRequest(userId, {
      gameId: service!.id,
      amount: "49.99",
      userGameId: "1XBET-USER-MIN",
      idempotencyKey: `GS-TEST-${stamp}-MIN-DEP`,
    }), /أقل مبلغ للإيداع/);
    await assert.rejects(() => createGameWithdrawRequest(userId, {
      gameId: service!.id,
      amount: "49.99",
      userGameId: "1XBET-USER-MIN",
      withdrawalCode: "WD-MIN",
      idempotencyKey: `GS-TEST-${stamp}-MIN-WD`,
    }), /أقل مبلغ للسحب/);
    console.log("✓ default 50 EGP minimums are enforced independently for deposit and withdrawal");

    const deposit = await createGameDepositRequest(userId, {
      gameId: service!.id,
      amount: "100.00",
      userGameId: "1XBET-USER-7788",
      idempotencyKey: `GS-TEST-${stamp}-DEP`,
    });
    assert.equal(deposit.duplicate, false);
    assert.equal(deposit.request.kind, "deposit");
    assert.equal(Number(deposit.request.subtotalAmount), 100);
    assert.equal(Number(deposit.request.feeAmount), 10);
    assert.equal(Number(deposit.request.totalAmount), 110);
    let overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.reservedOrders), 110);
    assert.equal(Number(overview.wallet.available), 890);
    console.log("✓ 1xBet deposit hold includes the configured fee");

    const duplicate = await createGameDepositRequest(userId, {
      gameId: service!.id,
      amount: "100.00",
      userGameId: "1XBET-USER-7788",
      idempotencyKey: `GS-TEST-${stamp}-DEP`,
    });
    assert.equal(duplicate.duplicate, true);
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.reservedOrders), 110, "no double hold");
    console.log("✓ deposit retry is idempotent");

    const approvedDeposit = await reviewGameTopupRequest(userId, { requestId: deposit.request.id, status: "approved" });
    assert.equal(approvedDeposit.request.status, "approved");
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.balance), 890);
    assert.equal(Number(overview.wallet.reservedOrders), 0);
    const [depositTx] = await db.select().from(transactions).where(eq(transactions.reference, `GT-TX-${deposit.request.reference}`)).limit(1);
    assert.ok(depositTx, "deposit debit transaction exists");
    assert.equal(Number(depositTx!.amount), 110);
    console.log("✓ deposit approval debits once and records the fee");

    const withdraw = await createGameWithdrawRequest(userId, {
      gameId: service!.id,
      amount: "50.00",
      userGameId: "1XBET-USER-7788",
      withdrawalCode: "WD-123456",
      idempotencyKey: `GS-TEST-${stamp}-WD`,
    });
    assert.equal(withdraw.request.kind, "withdraw");
    assert.equal(Number(withdraw.request.totalAmount), 50);
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.reservedOrders), 0, "withdraw does not reserve wallet funds");
    assert.equal(Number(overview.wallet.balance), 890);
    assert.equal(withdraw.request.city, "مدينة اختبار ثابتة");
    assert.equal(withdraw.request.street, "شارع اختبار ثابت");
    assert.equal(withdraw.request.withdrawalCode, "WD-123456");
    console.log("✓ withdrawal request stores city, street and withdrawal code without a hold");

    const approvedWithdraw = await reviewGameTopupRequest(userId, { requestId: withdraw.request.id, status: "approved" });
    assert.equal(approvedWithdraw.request.status, "approved");
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.balance), 890, "withdraw approval never debits the main wallet");
    assert.equal(Number(overview.wallet.reservedOrders), 0);
    await reviewGameTopupRequest(userId, { requestId: withdraw.request.id, status: "processing" });
    const completedWithdraw = await reviewGameTopupRequest(userId, { requestId: withdraw.request.id, status: "completed", providerReference: "1XBET-WD-REF" });
    assert.equal(completedWithdraw.request.status, "completed");
    console.log("✓ withdrawal approval, processing and completion keep the wallet unchanged");

    const cancelDeposit = await createGameDepositRequest(userId, {
      gameId: service!.id,
      amount: "60.00",
      userGameId: "1XBET-USER-CANCEL",
      idempotencyKey: `GS-TEST-${stamp}-CANCEL`,
    });
    const cancelled = await cancelGameTopupRequest(userId, cancelDeposit.request.id);
    assert.equal(cancelled.request.status, "cancelled");
    overview = await getGameTopupOverview(userId);
    assert.equal(Number(overview.wallet.reservedOrders), 0);
    assert.equal(Number(overview.wallet.balance), 890);
    console.log("✓ cancelling a deposit releases its hold");

    await assert.rejects(() => createGameDepositRequest(userId, {
      gameId: service!.id,
      amount: "0.00",
      userGameId: "1XBET-USER-ZERO",
      idempotencyKey: `GS-TEST-${stamp}-ZERO`,
    }), /أكبر من صفر/);
    await assert.rejects(() => createGameWithdrawRequest(userId, {
      gameId: service!.id,
      amount: "50.00",
      userGameId: "1XBET-USER-SHORT",
      withdrawalCode: "z",
      idempotencyKey: `GS-TEST-${stamp}-SHORT`,
    }), /كود السحب/);
    await db.update(gameTopupGames).set({ cityValue: "" }).where(eq(gameTopupGames.id, service!.id));
    await assert.rejects(() => createGameWithdrawRequest(userId, {
      gameId: service!.id,
      amount: "50.00",
      userGameId: "1XBET-USER-NO-CITY",
      withdrawalCode: "WD-NO-CITY",
      idempotencyKey: `GS-TEST-${stamp}-NO-CITY`,
    }), /لم تضبط الإدارة المدينة الثابتة/);
    console.log("✓ withdrawal cannot submit when fixed address text is not configured");
    await db.update(gameTopupGames).set({ cityValue: "مدينة اختبار ثابتة" }).where(eq(gameTopupGames.id, service!.id));
    await db.update(gameTopupGames).set({ minDepositAmount: "75.00", minWithdrawAmount: "60.00" }).where(eq(gameTopupGames.id, service!.id));
    await assert.rejects(() => createGameDepositRequest(userId, {
      gameId: service!.id,
      amount: "74.99",
      userGameId: "1XBET-USER-MIN-2",
      idempotencyKey: `GS-TEST-${stamp}-MIN-DEP-2`,
    }), /أقل مبلغ للإيداع/);
    await assert.rejects(() => createGameWithdrawRequest(userId, {
      gameId: service!.id,
      amount: "59.99",
      userGameId: "1XBET-USER-MIN-2",
      withdrawalCode: "WD-MIN-2",
      idempotencyKey: `GS-TEST-${stamp}-MIN-WD-2`,
    }), /أقل مبلغ للسحب/);
    console.log("✓ changing deposit and withdrawal minimums updates validation immediately");
    console.log("✓ deposit and withdrawal validation rejects invalid amounts and addresses");
    console.log("\nALL 1XBET GAME SERVICE TESTS PASSED");
  } finally {
    const rows = await db.select({ id: gameTopupRequests.id, reference: gameTopupRequests.reference }).from(gameTopupRequests).where(eq(gameTopupRequests.userId, userId));
    if (rows.length) {
      const ids = rows.map((row) => row.id);
      await db.delete(gameTopupFundingEntries).where(inArray(gameTopupFundingEntries.requestId, ids));
      await db.delete(gameTopupRequests).where(inArray(gameTopupRequests.id, ids));
      await db.delete(notifications).where(and(
        eq(notifications.userId, 90001),
        or(...rows.map((row) => like(notifications.body, `%${row.reference}%`))),
      ));
    }
    await db.delete(transactions).where(and(eq(transactions.userId, userId), like(transactions.reference, "GT-TX-%")));
    await db.delete(notifications).where(eq(notifications.userId, userId));
    await db.delete(wallets).where(eq(wallets.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await db.update(gameTopupSettings).set({ fundingBalance: fundingBefore }).where(eq(gameTopupSettings.id, 1));
    if (gameBefore) {
      await db.update(gameTopupGames).set({
        depositFeeEnabled: gameBefore.depositFeeEnabled,
        depositFeeAmount: gameBefore.depositFeeAmount,
        depositFeeMin: gameBefore.depositFeeMin,
        depositFeeMax: gameBefore.depositFeeMax,
        minDepositAmount: gameBefore.minDepositAmount,
        minWithdrawAmount: gameBefore.minWithdrawAmount,
        withdrawEnabled: gameBefore.withdrawEnabled,
        withdrawalInstructions: gameBefore.withdrawalInstructions,
        cityValue: gameBefore.cityValue,
        streetValue: gameBefore.streetValue,
      }).where(eq(gameTopupGames.id, gameBefore.id));
    }
    console.log("cleanup complete; test user, requests and fee settings restored");
  }
}
main().then(() => process.exit(0)).catch((error) => {
  console.error("TEST FAILED", error);
  process.exit(1);
});
