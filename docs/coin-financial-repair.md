# Coin and financial repair handoff

## Database ownership / current state

**No subagent DB writers are running. Last financial DB test finished at 13:37:42 UTC.** Read-only check at approximately 13:38:25 UTC confirmed `users`, `wallets`, `transactions`, `audit_logs`, `requests`, and `money_transfers` were all **0**. The three `payments-test-*` users seen by main at 13:37:13–13:37:37 were then-active tagged fixtures; the suite cleaned its recorded IDs. Main now has exclusive DB use.

Only `/home/ubuntu/flotexegp` was modified. `/home/ubuntu/flotex-original` was not connected to or changed. No commit, push, checkpoint, or publication was performed. No actual customer balances were used: mock balances were in process memory; integration balances belonged to freshly tagged synthetic IDs after the independent managed DB was established and users-count was checked as zero.

## Confirmed causes and fixes

1. **Missing control request wiring:** `AdminRequestsCenter` queried deposit/withdrawal, EGP transfer, savings, verification, phone, and support but not coin requests. It now includes pending buy/sell and coin transfers, routes them to the existing coin section, uses noncolliding order/transfer keys, and scrolls the existing modal. Partial query failure is shown instead of falsely saying no requests.
2. **Misidentified ledger owner/direction:** approved buys/sells wrote treasury inventory and treasury cash rows with the customer's `userId`, but no actual customer coin credit/debit ledger. Buys consequently appeared as coin deductions. New treasury rows omit `userId`; a separate `trade` customer movement records actual quantity direction, coin balance-after, and EGP balance-after. Historic treasury rows remain untouched and are excluded from customer coin movement views. Existing order history still provides all historical trade details.
3. **Price notices absent:** price change only updated settings/audit. It now commits a durable customer notice with exact titles `تم خفض سعر الكوين` or `تم زيادة سعر الكوين`, then uses existing `sendPushOnce` after commit. If buy and sell move in opposite directions, each appropriate message explains its price side. Fee-only/unchanged saves do not announce price change. Same-direction changes are combined per customer.
4. **Retry identity not bound to payload:** coin duplicate lookup returned an existing order/transfer/adjustment without checking owner and parameters. It now verifies owner, side/recipient, quantity, and administrative source/direction as appropriate. Locking duplicate reads happen after a common serialization lock, avoiding stale concurrent-retry snapshots. Pending/cancel/review semantics remain unchanged; terminal reviews cannot move balances twice. Explicit wallet/treasury row locks and one coin mutation lock order also cover opposing transfers.
5. **Client retries generated new keys every tap:** buy/sell/send and admin inventory/funding now synchronously block duplicate taps and retain an operation key for the same payload after uncertain network failure. Successful completion or edited payload gets a new key. Existing button design/placement was preserved.
6. **Decimal arithmetic:** persisted coin/EGP movements and trade price multiplication used floating-point calculations. `server/coin-math.ts` uses integer-backed decimal operations and half-up product rounding to cents. Underflows, zero net orders, and schema-sized overflows fail closed. All coin balance/treasury additions and subtractions now preserve six decimals, including large balances. Cancellation/rejection cannot silently zero-clamp an unmatched reservation.
7. **Incomplete dossier:** new read-only `getAdminCustomerCoinDetails` exposes actual total/reserved/available coins and paginated orders/transfers/customer ledger. UI pagination includes these collections, and buy/sell cards show quantity, price, gross, fee, net/total, reference, status, timestamps, reviewer, and rejection reason. Withdrawal cards expose existing channel/destination/fee/reference/review/notes plus payout reference and reviewer when main adds those fields to the existing server selection.
8. **Legacy custom-field crash:** `validateCustomFieldValues` called `.map` on missing method fields. Missing legacy fields now mean an empty custom schema, while malformed configured schemas and unapproved submitted keys still fail closed. Production `getPaymentMethods` already normalizes missing field definitions to `[]`; compatibility remains useful for older callers/fixtures. No production authorization or KYC policy was weakened.
9. **Stale original financial tests:** admin fixtures omitted the approved `ADMIN_EMAIL`, and callers sometimes forged an admin role while email remained null. Fixtures now use explicit synthetic approved-admin identities. Assertions now include fees, the split principal/fee ledger snapshots, mandatory rejection reasons, current descriptions/references, and fee-tier coverage when lowering withdrawal limits. Money-transfer cleanup was narrowed from global wildcard recovery to this run's own `fixtureIds`.

`server/balance-adjustment.ts` was inspected and deliberately not changed: it already locks the wallet, protects all reservations, commits balance/audit/ledger/internal notification together, rejects duplicate administrative operation IDs, and pushes only after commit. Its original integration cases now pass with valid synthetic admin fixtures.

## Files changed / added by finance subagent

- `server/coin.ts`, new `server/coin-math.ts`, new `shared/coin-operation.ts`.
- `components/control/CoinAdmin.tsx`, `CustomerDossier.tsx`, `AdminRequestsCenter.tsx`.
- `components/CoinOrderForm.tsx`, `app/coin-send.tsx` (coin-wallet's existing ledger rendering consumes the corrected server ledger; no file change needed).
- `shared/payment-method-fields.ts`, `tests/payment-method-fields.test.ts`.
- New `tests/helpers/finance-memory-db.ts`, `tests/coin-finance.unit.test.ts`, `tests/coin-math.test.ts`.
- Updated `tests/balance-ledger.test.ts`, `customer-topup.test.ts`, `withdrawal-safety.test.ts`, `payments-flow.test.ts`, `money-transfers.test.ts`.
- New guarded `scripts/test-coin-integration.ts`; this report and coordination note.

Main owns the additive `trade` schema migration and `server/customer-admin.ts` integration. The main agent has confirmed it is merging both. Ensure `getAdminCustomerDetails` returns `coin: await getAdminCustomerCoinDetails(adminId,userId,offset,limit)` and includes `requests.payoutReference`, `requests.reviewedBy` in its existing request projection.

## Validation actually performed

- **29/29 isolated tests PASS**, last run 13:39:14 UTC. This is 21 coin service mock cases (replay, ownership, reserve/approve/cancel/reject, actual user ledger, atomic rollback, notices, admin adjustments, dossier pagination and read-only behavior, invalid input), four integer-math/client retry cases, and four dynamic-field cases. The memory mutex verifies application replay logic, not InnoDB's real concurrency.
- **`pnpm check` PASS**, last run 13:39 UTC after current shared changes and finance edits.
- Original financial integration subset: `balance-ledger` **7/7**, `customer-topup` **1/1**, `withdrawal-safety` **5/5** passed on the empty independent managed DB. Latest money-transfer rerun **11/11** passed. Latest payment-flow rerun **11/12** passed; sole remaining failure was a stale expected source `manual_withdrawal` versus the actual pending/final principal source `withdrawal_request`. That exact assertion has now been corrected based on service and DB evidence, but was intentionally **not rerun** to avoid colliding with main's browser fixture. Main must confirm final complete suite rather than claim it already passed.
- Logs: `/tmp/flotex-coin-unit-final.log`, `/tmp/flotex-finance-integration.log`, `/tmp/flotex-finance-final.log`, `/tmp/flotex-coin-check-final.log`.
- Guard-only run of `scripts/test-coin-integration.ts` with test variables removed correctly **REFUSED before connecting**. **Real coin DB integration script not executed by subagent**, waiting for main's additive enum migration and exclusive fixture window.
- No tests were skipped to hide baseline failures. A one-time `PROTOCOL_CONNECTION_LOST` in the initial baseline was not reproduced in the two subsequent financial runs; no financial mutation was blindly retried in production code.

## Exact safe execution instructions for main

Run only after (a) additive `trade` migration succeeds, (b) browser/KYC fixtures are fully cleaned, (c) the DB is confirmed independent, and (d) no other test/dev operation is writing. Never connect the original DSN. Do not wipe rows to make a guard pass; investigate ownership instead.

For the standalone script, explicitly supply the already-confirmed independent DSN through protected environment, and the independently confirmed DB name:

```sh
cd /home/ubuntu/flotexegp
export TEST_DATABASE_URL="$DATABASE_URL" # ONLY after verifying this is the independent managed Flotex EGP DB
export FINANCE_TEST_DB_NAME='<confirmed independent schema name>'
export FINANCE_TEST_DSN_SHA256="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.env.TEST_DATABASE_URL).digest("hex"))')"
export FINANCE_TEST_CONFIRM=EMPTY_INDEPENDENT_FLOTEXEGP
pnpm exec tsx scripts/test-coin-integration.ts
```

Do not echo DSNs or enable `set -x`. The script refuses any non-empty user/financial/notice/push table and refuses an enum without `trade` **before writes**. It tests real buy/sell/send pending reservations, concurrent same-key retry/review, actual wallets and ledger, pending visibility in the admin dashboard, cancellation, no overselling, admin EGP add/deduct, exact internal price notices, and actual dossier quantities. It cleans **only recorded tagged synthetic IDs** and restores original coin singleton snapshots. No push tokens or real notification recipients are used; phone push delivery is not claimed.

Then, after the script confirms cleanup and there are no browser fixtures:

```sh
FLOTEX_ISOLATED_TEST_DB=1 pnpm test
```

This flag is required by main's guarded phone integration test. Confirm empty independent DB and exclusivity before the full suite too: old suites can create fixtures and change global settings. Main handles final full-suite result and real browser/mobile validation. Hardware push delivery and actual phone keyboard operation remain outside the evidence from these finance tests.
