import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/** Opt-in only. No environment loading or fallback to the application's current DB. */
async function main() {
  const dsn = process.env.TEST_DATABASE_URL;
  if (process.env.FINANCE_TEST_CONFIRM !== "EMPTY_INDEPENDENT_FLOTEXEGP" || !dsn) throw Error("REFUSED: explicitly supply independent TEST_DATABASE_URL and FINANCE_TEST_CONFIRM");
  if (createHash("sha256").update(dsn).digest("hex") !== process.env.FINANCE_TEST_DSN_SHA256) throw Error("REFUSED: expected test DSN fingerprint does not match");
  const connection = await mysql.createConnection(dsn);
  try {
    const [[database]] = await connection.query<any[]>("SELECT DATABASE() AS name");
    if (!process.env.FINANCE_TEST_DB_NAME || database.name !== process.env.FINANCE_TEST_DB_NAME) throw Error("REFUSED: expected independent DB name does not match");
    for (const table of ["users", "wallets", "transactions", "audit_logs", "coin_orders", "coin_transfers", "coin_wallets", "coin_ledger_entries", "coin_price_audits", "notifications", "push_tokens", "push_deliveries"]) {
      const [[row]] = await connection.query<any[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
      if (Number(row.count) !== 0) throw Error(`REFUSED: ${table} is not empty; do not erase rows to satisfy this guard`);
    }
    const [[column]] = await connection.query<any[]>("SELECT COLUMN_TYPE AS kindType FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coin_ledger_entries' AND COLUMN_NAME = 'kind'");
    if (!column?.kindType?.includes("'trade'")) throw Error("REFUSED: additive coin ledger trade migration must be applied first");
    console.log("Guard passed: empty confirmed independent DB; no existing customers or push tokens.");
  } finally { await connection.end(); }
  // Load services only after guards, using exactly the explicitly chosen test connection.
  process.env.DATABASE_URL = dsn;
  const [{ getDb }, schema, coin, { applyBalanceAdjustment }, { eq, inArray, or }, { hashPassword }] = await Promise.all([
    import("../server/db"), import("../drizzle/schema"), import("../server/coin"), import("../server/balance-adjustment"), import("drizzle-orm"), import("../server/manual-auth-crypto"),
  ]);
  const { users, wallets, coinWallets, coinSettings, coinTreasuries, coinLedgerEntries, coinOrders, coinTransfers, coinPriceAudits, transactions, notifications, auditLogs, pushDeliveries, pushTokens } = schema;
  const db = (await getDb())!;
  const prefix = `isolated-coin-${randomUUID()}`;
  const ids: number[] = [];
  const [originalSettings] = await db.select().from(coinSettings).where(eq(coinSettings.id, 1));
  const [originalTreasury] = await db.select().from(coinTreasuries).where(eq(coinTreasuries.id, 1));
  const key = (name: string) => `FC-IT-${name}-${randomUUID()}`;
  let admin = 0, sender = 0, recipient = 0;
  try {
    const { ADMIN_EMAIL } = await import("../shared/admin");
    const securityPinHash = await hashPassword("1234");
    for (const role of ["admin", "user", "user"] as const) {
      const openId = `${prefix}-${ids.length}`;
      await db.insert(users).values({ openId, customerId: randomInt(1, 10_000_000_000).toString().padStart(10, "0"), name: `Synthetic coin ${role} ${ids.length}`, role, email: role === "admin" ? ADMIN_EMAIL : `${openId}@example.test`, loginMethod: "isolated-coin-test", securityPinHash, securityPinUpdatedAt: new Date() });
      const [row] = await db.select().from(users).where(eq(users.openId, openId)); ids.push(row.id);
    }
    [admin, sender, recipient] = ids;
    await coin.updateCoinSettings(admin, { buyPrice: "50", sellPrice: "50", buyFee: "1", sellFee: "1", transferMinimum: "2", buyFeeEnabled: true, sellFeeEnabled: true });
    await coin.recordCoinInventory(admin, { quantity: "100", source: "synthetic inventory", direction: "credit", idempotencyKey: key("stock") });
    await coin.fundCoinSales(admin, { amount: "10000", source: "synthetic funding", idempotencyKey: key("fund") });
    await applyBalanceAdjustment(admin, sender, "1000", "synthetic EGP funding", key("egp"));
    await coin.adjustUserCoinBalance(admin, sender, "10", "synthetic coin funding", key("coin"));
    await coin.adjustUserCoinBalance(admin, recipient, "1", "synthetic recipient funding", key("recipient"));
    const wallet = async (id: number) => (await db.select().from(wallets).where(eq(wallets.userId, id)))[0];
    const coinWallet = async (id: number) => (await db.select().from(coinWallets).where(eq(coinWallets.userId, id)))[0];
    const buyInput = { side: "buy" as const, quantity: "2", securityPin: "1234", idempotencyKey: key("buy") };
    const buys = await Promise.all([coin.createCoinOrder(sender, buyInput), coin.createCoinOrder(sender, buyInput)]);
    assert.equal(buys.filter(row => row.duplicate).length, 1);
    assert((await coin.getAdminCoinDashboard()).pending.some(row => row.id === buys[0].order.id), "buy visible in admin requests");
    assert.equal((await wallet(sender)).balance, "1000.00"); assert.equal((await wallet(sender)).reservedOrders, "101.00");
    await assert.rejects(coin.createCoinOrder(recipient, buyInput), /مختلف/);
    await Promise.all([coin.reviewCoinOrder(admin, buys[0].order.id, "approved"), coin.reviewCoinOrder(admin, buys[0].order.id, "approved")]);
    assert.equal((await wallet(sender)).balance, "899.00"); assert.equal((await coinWallet(sender)).balance, "12.000000");
    const sale = await coin.createCoinOrder(sender, { side: "sell", quantity: "2", securityPin: "1234", idempotencyKey: key("sell") });
    assert.equal((await coinWallet(sender)).reserved, "2.000000");
    await coin.reviewCoinOrder(admin, sale.order.id, "approved"); await coin.reviewCoinOrder(admin, sale.order.id, "approved");
    assert.equal((await wallet(sender)).balance, "998.00"); assert.equal((await coinWallet(sender)).balance, "10.000000");
    const [recipientRow] = await db.select().from(users).where(eq(users.id, recipient));
    const transferInput = { recipientCustomerId: recipientRow.customerId, quantity: "2", securityPin: "1234", idempotencyKey: key("send") };
    const transfer = await coin.createCoinTransfer(sender, transferInput);
    assert((await coin.getAdminCoinDashboard()).pendingTransfers.some(row => row.id === transfer.transfer.id), "send visible in admin requests");
    assert.equal((await coin.createCoinTransfer(sender, transferInput)).duplicate, true);
    assert.equal((await coinWallet(sender)).balance, "10.000000"); assert.equal((await coinWallet(recipient)).balance, "1.000000");
    await Promise.all([coin.reviewCoinTransfer(admin, transfer.transfer.id, "approved"), coin.reviewCoinTransfer(admin, transfer.transfer.id, "approved")]);
    assert.equal((await coinWallet(sender)).balance, "8.000000"); assert.equal((await coinWallet(recipient)).balance, "3.000000");
    for (const side of ["buy", "sell"] as const) {
      const pending = await coin.createCoinOrder(sender, { side, quantity: "1", securityPin: "1234", idempotencyKey: key(`cancel-${side}`) });
      await coin.cancelCoinOrder(sender, pending.order.id); await coin.cancelCoinOrder(sender, pending.order.id);
    }
    assert.equal((await wallet(sender)).balance, "998.00"); assert.equal((await wallet(sender)).reservedOrders, "0.00"); assert.equal((await coinWallet(sender)).reserved, "0.000000");
    const adjustKey = key("adjust");
    await applyBalanceAdjustment(admin, sender, "10", "synthetic admin addition", adjustKey);
    await assert.rejects(applyBalanceAdjustment(admin, sender, "10", "synthetic admin addition", adjustKey), /مسبق/);
    await applyBalanceAdjustment(admin, sender, "-5", "synthetic admin debit", key("deduct"));
    assert.equal((await wallet(sender)).balance, "1003.00");
    await assert.rejects(coin.createCoinOrder(sender, { side: "sell", quantity: "9", securityPin: "1234", idempotencyKey: key("oversell") }), /غير كاف/);
    const price = { buyPrice: "45", sellPrice: "45", buyFee: "1", sellFee: "1", transferMinimum: "2", buyFeeEnabled: true, sellFeeEnabled: true };
    await coin.updateCoinSettings(admin, price); await coin.updateCoinSettings(admin, { ...price, buyPrice: "55", sellPrice: "55" });
    const notices = await db.select().from(notifications).where(eq(notifications.userId, sender));
    assert(notices.some(row => row.title === "تم خفض سعر الكوين")); assert(notices.some(row => row.title === "تم زيادة سعر الكوين"));
    assert(notices.some(row => row.title === "تمت إضافة أموال إلى محفظتك")); assert(notices.some(row => row.title === "تم خصم أموال من محفظتك"));
    const dossier = await coin.getAdminCustomerCoinDetails(admin, sender, 0, 50);
    assert.equal(dossier.wallet.balance, "8.000000"); assert.equal(dossier.orders.total, 4); assert.equal(dossier.transfers.total, 1);
    assert.equal(dossier.ledger.items.filter(row => String(row.kind) === "trade").length, 2);
    assert(!dossier.ledger.items.some(row => ["inventory", "buy_cash", "sell_funding"].includes(row.kind)));
    console.log("PASS: coin buy/sell/send, pending reservations, concurrent idempotency, actual ledger/dossier and internal price/admin notices.");
    console.log("Push device delivery is NOT claimed: no tokens or real recipients were used.");
  } finally {
    // Cleanup ONLY this run's recorded synthetic IDs; no wildcard or customer-prefix deletion.
    if (ids.length) {
      const owned = await db.select().from(users).where(inArray(users.id, ids));
      assert(owned.every(row => row.openId.startsWith(prefix)), "REFUSED cleanup: fixture ownership mismatch");
      for (const table of [pushDeliveries, pushTokens, notifications, transactions, coinOrders, coinWallets, wallets]) await db.delete(table).where(inArray(table.userId, ids));
      await db.delete(coinTransfers).where(or(inArray(coinTransfers.senderUserId, ids), inArray(coinTransfers.recipientUserId, ids)));
      await db.delete(coinLedgerEntries).where(or(inArray(coinLedgerEntries.userId, ids), inArray(coinLedgerEntries.adminId, ids)));
      await db.delete(coinPriceAudits).where(inArray(coinPriceAudits.adminId, ids));
      await db.delete(auditLogs).where(inArray(auditLogs.targetUserId, ids));
      await db.delete(users).where(inArray(users.id, ids));
      // This script requires exclusive test ownership; restore prior singleton configuration.
      if (originalSettings) await db.update(coinSettings).set(originalSettings).where(eq(coinSettings.id, 1)); else await db.delete(coinSettings).where(eq(coinSettings.id, 1));
      if (originalTreasury) await db.update(coinTreasuries).set(originalTreasury).where(eq(coinTreasuries.id, 1)); else await db.delete(coinTreasuries).where(eq(coinTreasuries.id, 1));
      console.log("Cleaned recorded synthetic fixture IDs and restored original singleton settings.");
    }
    await (db as any).$client.end();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "financial test failed"); process.exitCode = 1; });
