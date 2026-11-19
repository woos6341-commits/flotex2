import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  gameTopupFundingEntries,
  gameTopupGames,
  gameTopupPackages,
  gameTopupRequests,
  gameTopupSettings,
  notifications,
  transactions,
  users,
  wallets,
} from "../drizzle/schema";
import { ADMIN_EMAIL } from "../shared/admin";
import { getPendingRecentOperationStatuses } from "../shared/recent-operations";
import { addDecimal, decimal, scaled, subtractDecimal } from "./coin-math";
import { getDb } from "./db";
import { decodePaymentImage } from "./payment-media";
import { storagePut } from "./storage";

const SETTINGS_ID = 1;
const MAX_PLAYER_FIELDS = 8;
const MAX_IMAGE_BYTES = 1_500_000;

export type GameTopupStatus = "new" | "under_review" | "approved" | "processing" | "completed" | "rejected" | "cancelled";
export type GameTopupKind = "topup" | "deposit" | "withdraw";
export type GameTopupPlayerField = { key: string; label: string; placeholder?: string; required: boolean; type?: "text" | "number" };
export type GameTopupPlayerValue = { key: string; label: string; value: string };

export type GameTopupGameView = ReturnType<typeof gameView>;
export type GameTopupRequestView = ReturnType<typeof requestView>;
export type GameTopupResult = { duplicate: boolean; request: GameTopupRequestView; message: string };
export type GameTopupFundingEntryView = { id: number; direction: "credit" | "debit"; amount: string; feeAmount: string; balanceAfter: string; note: string | null; createdAt: Date };
export const GAME_TOPUP_STATUS_LABELS: Record<GameTopupStatus, string> = {
  new: "جديد",
  under_review: "قيد المراجعة",
  approved: "مقبول",
  processing: "جارٍ التنفيذ",
  completed: "مكتمل",
  rejected: "مرفوض",
  cancelled: "ملغي",
};
export const GAME_TOPUP_KIND_LABELS: Record<GameTopupKind, string> = {
  topup: "شحن ألعاب",
  deposit: "إيداع 1xBet",
  withdraw: "سحب 1xBet",
};

const DEFAULT_FIELDS: GameTopupPlayerField[] = [
  { key: "playerId", label: "Player ID", placeholder: "أدخل رقم اللاعب داخل اللعبة", required: true },
  { key: "playerName", label: "اسم اللاعب", placeholder: "أدخل اسم اللاعب داخل اللعبة", required: true },
];

const DEFAULT_GAMES = [
  {
    slug: "pubg-mobile",
    imageUrl: "/manus-storage/async-images/g6BAzhYlELmq66M3FS7gqW/image-1.webp",
    name: "PUBG Mobile",
    currencyLabel: "شدة",
    minQuantity: 30,
    unitPrice: "0.8333",
    sortOrder: 1,
    packages: [
      { quantity: 30, price: "25.00", label: "30 شدة" },
      { quantity: 60, price: "50.00", label: "60 شدة" },
      { quantity: 325, price: "250.00", label: "325 شدة" },
      { quantity: 660, price: "500.00", label: "660 شدة" },
    ],
  },
  {
    slug: "free-fire",
    imageUrl: "/manus-storage/async-images/g6BAzhYlELmq66M3FS7gqW/image-2.webp",
    name: "Free Fire",
    currencyLabel: "جوهرة",
    minQuantity: 100,
    unitPrice: "0.6000",
    sortOrder: 2,
    packages: [
      { quantity: 100, price: "60.00", label: "100 جوهرة" },
      { quantity: 220, price: "130.00", label: "220 جوهرة" },
      { quantity: 530, price: "310.00", label: "530 جوهرة" },
    ],
  },
  {
    slug: "mobile-legends",
    imageUrl: "/manus-storage/async-images/g6BAzhYlELmq66M3FS7gqW/image-3.webp",
    name: "Mobile Legends",
    currencyLabel: "جوهرة",
    minQuantity: 14,
    unitPrice: "1.7857",
    sortOrder: 3,
    packages: [
      { quantity: 14, price: "25.00", label: "14 جوهرة" },
      { quantity: 28, price: "50.00", label: "28 جوهرة" },
      { quantity: 59, price: "100.00", label: "59 جوهرة" },
    ],
  },
] as const;

const DEFAULT_SERVICE_GAMES = [
  {
    slug: "1xbet",
    name: "1xBet",
    imageUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519664086660136/fOkdkbeCXPlizgSk.png",
    currencyLabel: "ج.م",
    sortOrder: 4,
    fields: [{ key: "userId", label: "ID المستخدم", placeholder: "أدخل ID المستخدم في 1xBet", required: true, type: "text" as const }],
    withdrawalInstructions: "١. افتح صفحة السحب واختر طريقة السحب المناسبة.\n٢. أدخل ID المستخدم في 1xBet وكود السحب والبيانات المطلوبة بدقة.\n٣. أرسل الطلب وانتظر مراجعة الإدارة والتحقق من استلام المبلغ.\n٤. بعد الاعتماد يُضاف المبلغ إلى محفظة Flotex وتظهر الحالة في سجل الخدمة.\n٥. لا تشارك كود السحب مع أي شخص آخر.",
  },
] as const;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeFields(raw: string | null | undefined): GameTopupPlayerField[] {
  const parsed = parseJson<unknown>(raw, null);
  if (!Array.isArray(parsed)) return DEFAULT_FIELDS;
  const fields = parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      key: String(item.key ?? "").trim(),
      label: String(item.label ?? "").trim(),
      placeholder: String(item.placeholder ?? "").trim() || undefined,
      required: item.required !== false,
      type: item.type === "number" ? "number" as const : "text" as const,
    }))
    .filter((item) => /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(item.key) && item.label.length > 0)
    .slice(0, MAX_PLAYER_FIELDS);
  return fields.length ? fields : DEFAULT_FIELDS;
}

function normalizePlayerData(raw: string): GameTopupPlayerValue[] {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ key: String(item.key ?? ""), label: String(item.label ?? ""), value: String(item.value ?? "") }))
    .filter((item) => item.label && item.value);
}

function makeReference() {
  return `GT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 5).toUpperCase()}`;
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function cents(value: string | number) {
  return scaled(value, 2);
}

function numberFromCents(value: bigint) {
  return Number(decimal(value, 2));
}

function availableCents(wallet: { balance: string; reservedWithdrawals: string; reservedOrders: string; reservedTransfers: string; reservedSavings: string }) {
  return cents(wallet.balance) - cents(wallet.reservedWithdrawals) - cents(wallet.reservedOrders) - cents(wallet.reservedTransfers) - cents(wallet.reservedSavings);
}

function formatMoney(value: string | number) {
  return numberFromCents(cents(value)).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Fee actually charged: disabled -> 0, otherwise clamped to the configured min/max. */
function effectiveFee(settings: any): string {
  if (!settings.feeEnabled) return "0.00";
  let fee = cents(settings.feeAmount);
  const min = cents(settings.feeMin);
  const max = cents(settings.feeMax);
  if (fee < min) fee = min;
  if (max > 0n && fee > max) fee = max;
  return decimal(fee, 2);
}

/** Deposit fee configured per game; clamped to the game's min/max. */
function depositFeeFor(game: typeof gameTopupGames.$inferSelect): string {
  if (!game.depositFeeEnabled) return "0.00";
  let fee = cents(game.depositFeeAmount);
  const min = cents(game.depositFeeMin);
  const max = cents(game.depositFeeMax);
  if (fee < min) fee = min;
  if (max > 0n && fee > max) fee = max;
  return decimal(fee < 0n ? 0n : fee, 2);
}

async function ensureDefaultServiceGames(tx: any) {
  for (const service of DEFAULT_SERVICE_GAMES) {
    await tx.insert(gameTopupGames).values({
      slug: service.slug,
      name: service.name,
      serviceType: "deposit_withdraw",
      imageUrl: service.imageUrl,
      currencyLabel: service.currencyLabel,
      minQuantity: 1,
      unitPrice: "0.0000",
      fieldsJson: JSON.stringify(service.fields),
      depositFeeEnabled: true,
      depositFeeAmount: "0.00",
      depositFeeMin: "0.00",
      depositFeeMax: "0.00",
      minDepositAmount: "50.00",
      minWithdrawAmount: "50.00",
      withdrawEnabled: true,
      withdrawalInstructions: service.withdrawalInstructions,
      cityLabel: "المدينة",
      cityPlaceholder: "أدخل المدينة",
      streetLabel: "الشارع",
      streetPlaceholder: "أدخل الشارع",
      withdrawalCodeLabel: "أدخل كود السحب",
      userIdFieldLabel: "ID المستخدم",
      sortOrder: service.sortOrder,
      isActive: true,
    }).onDuplicateKeyUpdate({ set: { slug: service.slug } });
  }
}

async function ensureSettings(tx: any) {
  const [existing] = await tx.select().from(gameTopupSettings).where(eq(gameTopupSettings.id, SETTINGS_ID)).for("update").limit(1);
  if (existing) {
    await ensureDefaultServiceGames(tx);
    return existing;
  }
  await tx.insert(gameTopupSettings).values({ id: SETTINGS_ID, enabled: true, fundingBalance: "0.00" }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
  const [created] = await tx.select().from(gameTopupSettings).where(eq(gameTopupSettings.id, SETTINGS_ID)).for("update").limit(1);
  const [count] = await tx.select({ total: sql<number>`COUNT(*)` }).from(gameTopupGames);
  if (Number(count?.total ?? 0) === 0) {
    for (const game of DEFAULT_GAMES) {
      await tx.insert(gameTopupGames).values({
        slug: game.slug,
        name: game.name,
        serviceType: "topup",
        imageUrl: game.imageUrl,
        currencyLabel: game.currencyLabel,
        minQuantity: game.minQuantity,
        unitPrice: game.unitPrice,
        fieldsJson: JSON.stringify(DEFAULT_FIELDS),
        sortOrder: game.sortOrder,
        isActive: true,
      }).onDuplicateKeyUpdate({ set: { slug: game.slug } });
      const [row] = await tx.select().from(gameTopupGames).where(eq(gameTopupGames.slug, game.slug)).limit(1);
      if (!row) continue;
      const [packageCount] = await tx.select({ total: sql<number>`COUNT(*)` }).from(gameTopupPackages).where(eq(gameTopupPackages.gameId, row.id));
      if (Number(packageCount?.total ?? 0) === 0) {
        await tx.insert(gameTopupPackages).values(game.packages.map((item, index) => ({
          gameId: row.id,
          label: item.label,
          quantity: item.quantity,
          price: item.price,
          sortOrder: index + 1,
          isActive: true,
        })));
      }
    }
  }
  await ensureDefaultServiceGames(tx);
  return created;
}

async function ensureMainWallet(tx: any, userId: number) {
  await tx.insert(wallets).values({ userId, balance: "0.00", currency: "EGP" }).onDuplicateKeyUpdate({ set: { userId } });
  const [row] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for("update").limit(1);
  if (!row) throw new Error("محفظة الجنيه غير موجودة");
  return row;
}

function gameView(row: typeof gameTopupGames.$inferSelect, packages: Array<typeof gameTopupPackages.$inferSelect>, includeInactive = false) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    serviceType: row.serviceType,
    currencyLabel: row.currencyLabel,
    imageUrl: row.imageUrl,
    minQuantity: row.minQuantity,
    unitPrice: row.unitPrice,
    fields: normalizeFields(row.fieldsJson),
    depositFeeEnabled: Boolean(row.depositFeeEnabled),
    depositFeeAmount: row.depositFeeAmount,
    depositFeeMin: row.depositFeeMin,
    depositFeeMax: row.depositFeeMax,
    minDepositAmount: row.minDepositAmount,
    minWithdrawAmount: row.minWithdrawAmount,
    withdrawEnabled: Boolean(row.withdrawEnabled),
    withdrawalInstructions: row.withdrawalInstructions,
    cityLabel: row.cityLabel,
    cityPlaceholder: row.cityPlaceholder,
    cityValue: row.cityValue,
    streetLabel: row.streetLabel,
    streetPlaceholder: row.streetPlaceholder,
    streetValue: row.streetValue,
    withdrawalCodeLabel: row.withdrawalCodeLabel,
    userIdFieldLabel: row.userIdFieldLabel,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    packages: packages
      .filter((item) => includeInactive || item.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.quantity - b.quantity)
      .map((item) => ({
        id: item.id,
        label: item.label,
        quantity: item.quantity,
        price: item.price,
        sortOrder: item.sortOrder,
        isActive: item.isActive,
      })),
  };
}

function requestView(row: typeof gameTopupRequests.$inferSelect, user?: { name: string | null; customerId: string } | null, currencyLabel?: string | null) {
  return {
    id: row.id,
    reference: row.reference,
    userId: row.userId,
    userName: user?.name ?? null,
    customerId: user?.customerId ?? null,
    gameId: row.gameId,
    gameName: row.gameName,
    kind: row.kind as GameTopupKind,
    kindLabel: GAME_TOPUP_KIND_LABELS[row.kind as GameTopupKind],
    currencyLabel: currencyLabel ?? null,
    packageId: row.packageId,
    packageLabel: row.packageLabel,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    subtotalAmount: row.subtotalAmount,
    feeAmount: row.feeAmount,
    totalAmount: row.totalAmount,
    playerData: normalizePlayerData(row.playerDataJson),
    city: row.city,
    street: row.street,
    withdrawalCode: row.withdrawalCode,
    status: row.status as GameTopupStatus,
    statusLabel: GAME_TOPUP_STATUS_LABELS[row.status as GameTopupStatus],
    adminNote: row.adminNote,
    rejectionReason: row.rejectionReason,
    providerReference: row.providerReference,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewedAt: row.reviewedAt,
    completedAt: row.completedAt,
  };
}

async function notifyAdmins(tx: any, request: typeof gameTopupRequests.$inferSelect) {
  const admins = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.role, "admin"), sql`lower(coalesce(${users.emailNormalized}, ${users.email})) = ${ADMIN_EMAIL}`));
  if (!admins.length) return;
  const kindLabel = GAME_TOPUP_KIND_LABELS[request.kind as GameTopupKind] ?? "طلب ألعاب";
  const detail = request.kind === "topup" ? `لكمية ${request.quantity}` : "";
  await tx.insert(notifications).values(admins.map((admin: { id: number }) => ({
    userId: admin.id,
    title: `${kindLabel} جديد`,
    body: `طلب ${request.gameName} ${detail} بقيمة ${formatMoney(request.totalAmount)} ج.م بانتظار المراجعة. رقم الطلب ${request.reference}.`,
    type: "game_topup",
    operationId: `game-topup:${request.reference}:admin-new:${request.kind}`,
  }))).onDuplicateKeyUpdate({ set: { userId: admins[0].id } });
}

async function notifyUser(tx: any, userId: number, title: string, body: string, operationId: string) {
  await tx.insert(notifications).values({ userId, title, body, type: "game_topup", operationId }).onDuplicateKeyUpdate({ set: { userId } });
}

export async function getGameTopupCatalog(): Promise<{ enabled: boolean; fee: { enabled: boolean; amount: string }; games: GameTopupGameView[] }> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx: any) => {
    const settings = await ensureSettings(tx);
    const games = await tx.select().from(gameTopupGames).where(eq(gameTopupGames.isActive, true)).orderBy(asc(gameTopupGames.sortOrder), asc(gameTopupGames.id));
    const packages = games.length
      ? await tx.select().from(gameTopupPackages).where(eq(gameTopupPackages.isActive, true)).orderBy(asc(gameTopupPackages.sortOrder))
      : [];
    return {
      enabled: Boolean(settings.enabled),
      fee: { enabled: Boolean(settings.feeEnabled), amount: effectiveFee(settings) },
      games: games.map((game: typeof gameTopupGames.$inferSelect) => gameView(game, packages.filter((item: typeof gameTopupPackages.$inferSelect) => item.gameId === game.id))),
    };
  });
}

export async function getGameTopupOverview(userId: number): Promise<{ enabled: boolean; wallet: { balance: string; reservedOrders: string; available: string; currency: string }; requests: GameTopupRequestView[] }> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx: any) => {
    const settings = await ensureSettings(tx);
    const wallet = await ensureMainWallet(tx, userId);
    const rows = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.userId, userId)).orderBy(desc(gameTopupRequests.createdAt)).limit(20);
    const games = await tx.select({ id: gameTopupGames.id, currencyLabel: gameTopupGames.currencyLabel }).from(gameTopupGames);
    const labels = new Map(games.map((item: { id: number; currencyLabel: string }) => [item.id, item.currencyLabel]));
    return {
      enabled: Boolean(settings.enabled),
      wallet: {
        balance: wallet.balance,
        reservedOrders: wallet.reservedOrders,
        available: decimal(availableCents(wallet), 2),
        currency: "EGP",
      },
      requests: rows.map((row: typeof gameTopupRequests.$inferSelect) => requestView(row, null, labels.get(row.gameId) as string | undefined)),
    };
  });
}

export async function createGameTopupRequest(userId: number, input: { gameId: number; packageId?: number | null; quantity?: number | null; fields: Record<string, string>; idempotencyKey: string }): Promise<GameTopupResult> {
  const operationKey = input.idempotencyKey.trim();
  if (operationKey.length < 12 || operationKey.length > 80) throw new Error("تعذر التحقق من الطلب؛ حاول مرة أخرى");
  const normalizedFields = Object.fromEntries(Object.entries(input.fields ?? {}).map(([key, value]) => [key, String(value ?? "").trim()]));
  const payloadHash = hashPayload({ gameId: input.gameId, packageId: input.packageId ?? null, quantity: input.quantity ?? null, fields: normalizedFields });
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  try {
    return await db.transaction(async (tx: any) => {
      // The tRPC financial middleware already serializes this customer and validates active status.
      // Locking the same user row again here would deadlock the request on a second connection.
      const [account] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
      if (!account || account.status !== "active") throw new Error("الحساب غير نشط؛ لا يمكن تنفيذ عمليات مالية.");
      const [existing] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.idempotencyKey, operationKey)).limit(1);
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new Error("تم استخدام مرجع العملية لطلب مختلف؛ أعد المحاولة.");
        return { duplicate: true, request: requestView(existing), message: "تم إرسال هذا الطلب بالفعل، ولا توجد خصومات إضافية." };
      }
      const settings = await ensureSettings(tx);
      if (!settings.enabled) throw new Error("خدمة شحن الألعاب متوقفة مؤقتًا. حاول لاحقًا.");
      const [game] = await tx.select().from(gameTopupGames).where(and(eq(gameTopupGames.id, input.gameId), eq(gameTopupGames.isActive, true))).limit(1);
      if (!game) throw new Error("اللعبة المطلوبة غير متاحة حاليًا");

      let quantity = 0;
      let subtotal = "0.00";
      let unitPrice = game.unitPrice;
      let packageRow: typeof gameTopupPackages.$inferSelect | null = null;
      if (input.packageId) {
        [packageRow] = await tx.select().from(gameTopupPackages).where(and(eq(gameTopupPackages.id, input.packageId), eq(gameTopupPackages.gameId, game.id), eq(gameTopupPackages.isActive, true))).limit(1);
        if (!packageRow) throw new Error("الباقة المختارة غير متاحة؛ اختر باقة أخرى.");
        quantity = packageRow.quantity;
        subtotal = packageRow.price;
        unitPrice = decimal((scaled(subtotal, 2) * 10000n + BigInt(quantity) * 50n) / (BigInt(quantity) * 100n), 4);
      } else {
        quantity = Number(input.quantity ?? 0);
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("أدخل كمية صحيحة أكبر من صفر");
        if (quantity < game.minQuantity) throw new Error(`أقل كمية متاحة لهذه اللعبة هي ${game.minQuantity} ${game.currencyLabel}`);
        if (scaled(game.unitPrice, 4) <= 0n) throw new Error("سعر الوحدة لهذه اللعبة غير مهيأ بعد؛ اختر باقة جاهزة أو تواصل مع الإدارة.");
        const unit4 = scaled(game.unitPrice, 4);
        const totalCents = (unit4 * BigInt(quantity) + 50n) / 100n;
        if (totalCents <= 0n) throw new Error("قيمة الطلب غير صالحة");
        subtotal = decimal(totalCents, 2);
        unitPrice = game.unitPrice;
      }

      const definedFields = normalizeFields(game.fieldsJson);
      const playerData: GameTopupPlayerValue[] = [];
      for (const field of definedFields) {
        const value = normalizedFields[field.key] ?? "";
        if (field.required && !value) throw new Error(`أدخل ${field.label}`);
        if (value.length > 120) throw new Error(`${field.label} أطول من الحد المسموح`);
        if (value) playerData.push({ key: field.key, label: field.label, value });
      }
      if (!playerData.length) throw new Error("أدخل بيانات اللاعب المطلوبة");

      const fee = effectiveFee(settings);
      const total = addDecimal(subtotal, fee, 2);
      const wallet = await ensureMainWallet(tx, userId);
      const amountCents = cents(total);
      if (availableCents(wallet) < amountCents) throw new Error("رصيد محفظتك غير كافٍ لإتمام الطلب");
      const reservedAfter = addDecimal(wallet.reservedOrders, total, 2);
      const updated = await tx.update(wallets).set({ reservedOrders: reservedAfter }).where(and(
        eq(wallets.userId, userId),
        sql`${wallets.balance} - ${wallets.reservedWithdrawals} - ${wallets.reservedOrders} - ${wallets.reservedTransfers} - ${wallets.reservedSavings} >= ${total}`,
      ));
      const affected = Array.isArray(updated) ? Number(updated[0]?.affectedRows ?? 0) : Number(updated?.affectedRows ?? 0);
      if (!affected) throw new Error("تغيّر رصيد محفظتك أثناء إنشاء الطلب؛ راجع الرصيد وأعد المحاولة.");

      const reference = makeReference();
      await tx.insert(gameTopupRequests).values({
        reference,
        userId,
        gameId: game.id,
        gameName: game.name,
        packageId: packageRow?.id ?? null,
        packageLabel: packageRow?.label ?? null,
        quantity,
        unitPrice,
        subtotalAmount: subtotal,
        feeAmount: fee,
        totalAmount: total,
        playerDataJson: JSON.stringify(playerData),
        status: "new",
        idempotencyKey: operationKey,
        payloadHash,
      });
      const [created] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.reference, reference)).limit(1);
      if (!created) throw new Error("تعذر قراءة الطلب بعد إنشائه");
      await notifyAdmins(tx, created);
      await notifyUser(tx, userId, "تم استلام طلب شحن الألعاب", `رقم الطلب ${reference}. تم حجز ${formatMoney(total)} ج.م مؤقتًا (شامل ${formatMoney(fee)} ج.م رسوم خدمة)، ولن يُخصم المبلغ نهائيًا قبل اعتماد الإدارة.`, `game-topup:${reference}:created`);
      return { duplicate: false, request: requestView(created), message: `تم إرسال الطلب رقم ${reference} وحجز ${formatMoney(total)} ج.م مؤقتًا (منها ${formatMoney(fee)} ج.م رسوم خدمة) بانتظار المراجعة.` };
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") {
      const [existing] = await db.select().from(gameTopupRequests).where(eq(gameTopupRequests.idempotencyKey, operationKey)).limit(1);
      if (existing && existing.payloadHash === payloadHash) return { duplicate: true, request: requestView(existing), message: "تم إرسال هذا الطلب بالفعل، ولا توجد خصومات إضافية." };
    }
    throw error;
  }
}

export async function createGameDepositRequest(userId: number, input: { gameId: number; amount: string; userGameId: string; idempotencyKey: string }): Promise<GameTopupResult> {
  const operationKey = input.idempotencyKey.trim();
  if (operationKey.length < 12 || operationKey.length > 80) throw new Error("تعذر التحقق من الطلب؛ حاول مرة أخرى");
  const amount = cents(input.amount);
  if (amount <= 0n) throw new Error("أدخل مبلغ إيداع أكبر من صفر");
  if (amount > 100_000_000n) throw new Error("مبلغ الإيداع أكبر من الحد المسموح");
  const userGameId = input.userGameId.trim();
  if (userGameId.length < 2 || userGameId.length > 120) throw new Error("أدخل ID المستخدم في 1xBet");
  const payloadHash = hashPayload({ kind: "deposit", gameId: input.gameId, amount: decimal(amount, 2), userGameId });
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  try {
    return await db.transaction(async (tx: any) => {
      const [account] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
      if (!account || account.status !== "active") throw new Error("الحساب غير نشط؛ لا يمكن تنفيذ عمليات مالية.");
      const [existing] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.idempotencyKey, operationKey)).limit(1);
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new Error("تم استخدام مرجع العملية لطلب مختلف؛ أعد المحاولة.");
        return { duplicate: true, request: requestView(existing), message: "تم إرسال هذا الطلب بالفعل، ولا توجد خصومات إضافية." };
      }
      const settings = await ensureSettings(tx);
      if (!settings.enabled) throw new Error("خدمة الألعاب متوقفة مؤقتًا. حاول لاحقًا.");
      const [game] = await tx.select().from(gameTopupGames).where(and(eq(gameTopupGames.id, input.gameId), eq(gameTopupGames.isActive, true), eq(gameTopupGames.serviceType, "deposit_withdraw"))).limit(1);
      if (!game) throw new Error("خدمة اللعبة المطلوبة غير متاحة حاليًا");
      if (amount < cents(game.minDepositAmount)) throw new Error(`أقل مبلغ للإيداع هو ${formatMoney(game.minDepositAmount)} ج.م`);
      const fee = depositFeeFor(game);
      const total = addDecimal(decimal(amount, 2), fee, 2);
      const wallet = await ensureMainWallet(tx, userId);
      if (availableCents(wallet) < cents(total)) throw new Error("رصيد محفظتك غير كافٍ لإتمام الإيداع والرسوم");
      const reservedAfter = addDecimal(wallet.reservedOrders, total, 2);
      const updated = await tx.update(wallets).set({ reservedOrders: reservedAfter }).where(and(
        eq(wallets.userId, userId),
        sql`${wallets.balance} - ${wallets.reservedWithdrawals} - ${wallets.reservedOrders} - ${wallets.reservedTransfers} - ${wallets.reservedSavings} >= ${total}`,
      ));
      const affected = Array.isArray(updated) ? Number(updated[0]?.affectedRows ?? 0) : Number(updated?.affectedRows ?? 0);
      if (!affected) throw new Error("تغيّر رصيد محفظتك أثناء إنشاء الطلب؛ راجع الرصيد وأعد المحاولة.");
      const reference = makeReference();
      const playerData: GameTopupPlayerValue[] = [{ key: "userId", label: game.userIdFieldLabel, value: userGameId }];
      await tx.insert(gameTopupRequests).values({
        reference,
        userId,
        gameId: game.id,
        gameName: game.name,
        kind: "deposit",
        packageId: null,
        packageLabel: null,
        quantity: 0,
        unitPrice: "0.0000",
        subtotalAmount: decimal(amount, 2),
        feeAmount: fee,
        totalAmount: total,
        playerDataJson: JSON.stringify(playerData),
        status: "new",
        idempotencyKey: operationKey,
        payloadHash,
      });
      const [created] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.reference, reference)).limit(1);
      if (!created) throw new Error("تعذر قراءة الطلب بعد إنشائه");
      await notifyAdmins(tx, created);
      await notifyUser(tx, userId, "تم استلام طلب إيداع 1xBet", `رقم الطلب ${reference}. تم حجز ${formatMoney(total)} ج.م مؤقتًا (منها ${formatMoney(fee)} ج.م رسوم إيداع)، ولن يُخصم المبلغ نهائيًا قبل اعتماد الإدارة.`, `game-topup:${reference}:created`);
      return { duplicate: false, request: requestView(created), message: `تم إرسال طلب الإيداع ${reference} وحجز ${formatMoney(total)} ج.م (منها ${formatMoney(fee)} ج.م رسوم) بانتظار المراجعة.` };
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") {
      const [existing] = await db.select().from(gameTopupRequests).where(eq(gameTopupRequests.idempotencyKey, operationKey)).limit(1);
      if (existing && existing.payloadHash === payloadHash) return { duplicate: true, request: requestView(existing), message: "تم إرسال هذا الطلب بالفعل، ولا توجد خصومات إضافية." };
    }
    throw error;
  }
}

export async function createGameWithdrawRequest(userId: number, input: { gameId: number; amount: string; userGameId: string; withdrawalCode: string; idempotencyKey: string }): Promise<GameTopupResult> {
  const operationKey = input.idempotencyKey.trim();
  if (operationKey.length < 12 || operationKey.length > 80) throw new Error("تعذر التحقق من الطلب؛ حاول مرة أخرى");
  const amount = cents(input.amount);
  if (amount <= 0n) throw new Error("أدخل مبلغ سحب أكبر من صفر");
  if (amount > 100_000_000n) throw new Error("مبلغ السحب أكبر من الحد المسموح");
  const userGameId = input.userGameId.trim();
  if (userGameId.length < 2 || userGameId.length > 120) throw new Error("أدخل ID المستخدم في 1xBet بشكل صحيح");
  const withdrawalCode = input.withdrawalCode.trim();
  if (withdrawalCode.length < 2 || withdrawalCode.length > 160) throw new Error("أدخل كود السحب بشكل صحيح");
  const payloadHash = hashPayload({ kind: "withdraw", gameId: input.gameId, amount: decimal(amount, 2), userGameId, withdrawalCode });
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  try {
    return await db.transaction(async (tx: any) => {
      const [account] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
      if (!account || account.status !== "active") throw new Error("الحساب غير نشط؛ لا يمكن تنفيذ عمليات مالية.");
      const [existing] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.idempotencyKey, operationKey)).limit(1);
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new Error("تم استخدام مرجع العملية لطلب مختلف؛ أعد المحاولة.");
        return { duplicate: true, request: requestView(existing), message: "تم إرسال طلب السحب بالفعل، ولن يُضاف المبلغ إلى المحفظة أكثر من مرة." };
      }
      const settings = await ensureSettings(tx);
      if (!settings.enabled) throw new Error("خدمة الألعاب متوقفة مؤقتًا. حاول لاحقًا.");
      const [game] = await tx.select().from(gameTopupGames).where(and(eq(gameTopupGames.id, input.gameId), eq(gameTopupGames.isActive, true), eq(gameTopupGames.serviceType, "deposit_withdraw"))).limit(1);
      if (!game) throw new Error("خدمة اللعبة المطلوبة غير متاحة حاليًا");
      if (!game.withdrawEnabled) throw new Error("خدمة السحب لهذه اللعبة متوقفة مؤقتًا");
      if (amount < cents(game.minWithdrawAmount)) throw new Error(`أقل مبلغ للسحب هو ${formatMoney(game.minWithdrawAmount)} ج.م`);
      const city = game.cityValue.trim();
      const street = game.streetValue.trim();
      if (!city) throw new Error("لم تضبط الإدارة المدينة الثابتة للسحب بعد؛ تواصل مع خدمة العملاء.");
      if (!street) throw new Error("لم تضبط الإدارة الشارع الثابت للسحب بعد؛ تواصل مع خدمة العملاء.");
      const reference = makeReference();
      const playerData: GameTopupPlayerValue[] = [
        { key: "userId", label: game.userIdFieldLabel, value: userGameId },
        { key: "city", label: game.cityLabel, value: city },
        { key: "street", label: game.streetLabel, value: street },
        { key: "withdrawalCode", label: game.withdrawalCodeLabel, value: withdrawalCode },
      ];
      await tx.insert(gameTopupRequests).values({
        reference,
        userId,
        gameId: game.id,
        gameName: game.name,
        kind: "withdraw",
        packageId: null,
        packageLabel: null,
        quantity: 0,
        unitPrice: "0.0000",
        subtotalAmount: decimal(amount, 2),
        feeAmount: "0.00",
        totalAmount: decimal(amount, 2),
        playerDataJson: JSON.stringify(playerData),
        city,
        street,
        withdrawalCode,
        status: "new",
        idempotencyKey: operationKey,
        payloadHash,
      });
      const [created] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.reference, reference)).limit(1);
      if (!created) throw new Error("تعذر قراءة الطلب بعد إنشائه");
      await notifyAdmins(tx, created);
      await notifyUser(tx, userId, "تم استلام طلب سحب 1xBet", `رقم الطلب ${reference}. طلب سحب بقيمة ${formatMoney(decimal(amount, 2))} ج.م إلى ${city} - ${street} بانتظار مراجعة الإدارة.`, `game-topup:${reference}:created`);
      return { duplicate: false, request: requestView(created), message: `تم إرسال طلب السحب ${reference} بقيمة ${formatMoney(decimal(amount, 2))} ج.م بانتظار المراجعة.` };
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") {
      const [existing] = await db.select().from(gameTopupRequests).where(eq(gameTopupRequests.idempotencyKey, operationKey)).limit(1);
      if (existing && existing.payloadHash === payloadHash) return { duplicate: true, request: requestView(existing), message: "تم إرسال طلب السحب بالفعل، ولن يُضاف المبلغ إلى المحفظة أكثر من مرة." };
    }
    throw error;
  }
}

export async function cancelGameTopupRequest(userId: number, requestId: number): Promise<GameTopupResult> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx: any) => {
    const [request] = await tx.select().from(gameTopupRequests).where(and(eq(gameTopupRequests.id, requestId), eq(gameTopupRequests.userId, userId))).for("update").limit(1);
    if (!request) throw new Error("الطلب غير موجود");
    if (request.status === "cancelled") return { duplicate: true, request: requestView(request), message: "الطلب ملغي بالفعل." };
    if (request.status !== "new" && request.status !== "under_review") throw new Error("لا يمكن إلغاء الطلب بعد اعتماده؛ تواصل مع الإدارة.");
    if (request.kind !== "withdraw") {
      const wallet = await ensureMainWallet(tx, userId);
      if (cents(wallet.reservedOrders) < cents(request.totalAmount)) throw new Error("تعذر مطابقة حجز الطلب؛ تواصل مع الإدارة.");
      await tx.update(wallets).set({ reservedOrders: subtractDecimal(wallet.reservedOrders, request.totalAmount, 2) }).where(eq(wallets.userId, userId));
    }
    await tx.update(gameTopupRequests).set({ status: "cancelled" }).where(eq(gameTopupRequests.id, request.id));
    const [updated] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.id, request.id)).limit(1);
    return { duplicate: false, request: requestView(updated), message: "تم إلغاء الطلب وتحرير المبلغ المحجوز دون خصم." };
  });
}

export async function listMyGameTopupRequests(userId: number): Promise<GameTopupRequestView[]> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const rows = await db.select().from(gameTopupRequests).where(eq(gameTopupRequests.userId, userId)).orderBy(desc(gameTopupRequests.createdAt)).limit(50);
  const games = await db.select({ id: gameTopupGames.id, currencyLabel: gameTopupGames.currencyLabel }).from(gameTopupGames);
  const labels = new Map(games.map((item: { id: number; currencyLabel: string }) => [item.id, item.currencyLabel]));
  return rows.map((row: typeof gameTopupRequests.$inferSelect) => requestView(row, null, labels.get(row.gameId) as string | undefined));
}

export async function listAdminGameTopupRequests(input: { status?: "all" | "pending" | "archive" | GameTopupStatus; search?: string; limit?: number; offset?: number }): Promise<{ requests: GameTopupRequestView[]; total: number }> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const status = input.status && input.status !== "all" && input.status !== "pending" && input.status !== "archive" ? input.status : null;
  const search = input.search?.trim() ?? "";
  const conditions = [];
  if (input.status === "pending") conditions.push(inArray(gameTopupRequests.status, getPendingRecentOperationStatuses("gameTopup") as GameTopupStatus[]));
  else if (input.status === "archive") conditions.push(inArray(gameTopupRequests.status, ["approved", "processing", "completed", "rejected", "cancelled"]));
  else if (status) conditions.push(eq(gameTopupRequests.status, status));
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, "")}%`;
    conditions.push(or(
      like(gameTopupRequests.reference, pattern),
      like(gameTopupRequests.gameName, pattern),
      like(users.name, pattern),
      like(users.customerId, pattern),
    ));
  }
  const rows = await db.select({ request: gameTopupRequests, user: { name: users.name, customerId: users.customerId }, currencyLabel: gameTopupGames.currencyLabel })
    .from(gameTopupRequests)
    .leftJoin(users, eq(users.id, gameTopupRequests.userId))
    .leftJoin(gameTopupGames, eq(gameTopupGames.id, gameTopupRequests.gameId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(gameTopupRequests.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 100))
    .offset(Math.max(input.offset ?? 0, 0));
  const [count] = await db.select({ total: sql<number>`COUNT(*)` }).from(gameTopupRequests).leftJoin(users, eq(users.id, gameTopupRequests.userId)).where(conditions.length ? and(...conditions) : undefined);
  return { requests: rows.map((row: any) => requestView(row.request, row.user, row.currencyLabel)), total: Number(count?.total ?? 0) };
}

export async function reviewGameTopupRequest(adminId: number, input: { requestId: number; status: "under_review" | "approved" | "processing" | "completed" | "rejected"; rejectionReason?: string; providerReference?: string; adminNote?: string }): Promise<GameTopupResult> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx: any) => {
    const [request] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.id, input.requestId)).for("update").limit(1);
    if (!request) throw new Error("طلب الشحن غير موجود");
    const current = request.status as GameTopupStatus;
    const isWithdraw = request.kind === "withdraw";
    const kindLabel = GAME_TOPUP_KIND_LABELS[request.kind as GameTopupKind] ?? "طلب ألعاب";
    if (current === input.status) return { duplicate: true, request: requestView(request), message: "الطلب في هذه الحالة بالفعل." };
    if (input.status === "rejected") {
      if (current !== "new" && current !== "under_review") throw new Error("لا يمكن رفض طلب بعد اعتماده أو تنفيذه");
      const reason = input.rejectionReason?.trim();
      if (!reason || reason.length < 3) throw new Error("سبب الرفض إلزامي");
      if (!isWithdraw) {
        const wallet = await ensureMainWallet(tx, request.userId);
        if (cents(wallet.reservedOrders) < cents(request.totalAmount)) throw new Error("تعذر مطابقة المبلغ المحجوز قبل الرفض");
        await tx.update(wallets).set({ reservedOrders: subtractDecimal(wallet.reservedOrders, request.totalAmount, 2) }).where(eq(wallets.userId, request.userId));
      }
      await tx.update(gameTopupRequests).set({ status: "rejected", rejectionReason: reason, adminNote: input.adminNote?.trim() || request.adminNote, reviewedBy: adminId, reviewedAt: new Date() }).where(eq(gameTopupRequests.id, request.id));
      await notifyUser(tx, request.userId, `تم رفض ${kindLabel}`, isWithdraw
        ? `تم رفض طلب السحب ${request.reference}. السبب: ${reason}`
        : `تم رفض الطلب ${request.reference} وتحرير ${formatMoney(request.totalAmount)} ج.م المحجوز دون خصم. السبب: ${reason}`, `game-topup:${request.reference}:rejected`);
    } else if (input.status === "approved") {
      if (current !== "new" && current !== "under_review") throw new Error("لا يمكن اعتماد هذا الطلب في حالته الحالية");
      if (isWithdraw) {
        const wallet = await ensureMainWallet(tx, request.userId);
        const balanceAfter = addDecimal(wallet.balance, request.totalAmount, 2);
        await tx.update(wallets).set({ balance: balanceAfter }).where(eq(wallets.userId, request.userId));
        await tx.insert(transactions).values({
          userId: request.userId,
          reference: `GT-TX-${request.reference}`,
          type: "adjustment",
          amount: request.totalAmount,
          currency: "EGP",
          status: "approved",
          direction: "credit",
          note: `اعتماد سحب 1xBet ${request.reference}`,
          customerTitle: "سحب 1xBet",
          customerDescription: `إضافة ${formatMoney(request.totalAmount)} ج.م من طلب سحب 1xBet ${request.reference} بعد موافقة الإدارة.`,
          source: "game_topup",
          balanceBefore: wallet.balance,
          balanceAfter,
        });
        await tx.update(gameTopupRequests).set({ status: "approved", rejectionReason: null, adminNote: input.adminNote?.trim() || request.adminNote, reviewedBy: adminId, reviewedAt: new Date() }).where(eq(gameTopupRequests.id, request.id));
        await notifyUser(tx, request.userId, "تم اعتماد طلب سحب 1xBet", `تم اعتماد طلب السحب ${request.reference} وإضافة ${formatMoney(request.totalAmount)} ج.م إلى محفظة Flotex.`, `game-topup:${request.reference}:approved`);
      } else {
        const wallet = await ensureMainWallet(tx, request.userId);
        const amount = cents(request.totalAmount);
        if (cents(wallet.reservedOrders) < amount || cents(wallet.balance) < amount) throw new Error("لا يمكن الاعتماد بسبب رصيد غير كافٍ أو حجز غير مطابق");
        const balanceAfter = subtractDecimal(wallet.balance, request.totalAmount, 2);
        const reservedAfter = subtractDecimal(wallet.reservedOrders, request.totalAmount, 2);
        await tx.update(wallets).set({ balance: balanceAfter, reservedOrders: reservedAfter }).where(eq(wallets.userId, request.userId));
        const settings = await ensureSettings(tx);
        const fundingBefore = settings.fundingBalance;
        const fundingAfter = addDecimal(settings.fundingBalance, request.totalAmount, 2);
        await tx.update(gameTopupSettings).set({ fundingBalance: fundingAfter }).where(eq(gameTopupSettings.id, SETTINGS_ID));
        await tx.insert(gameTopupFundingEntries).values({
          requestId: request.id,
          direction: "credit",
          amount: request.totalAmount,
          feeAmount: request.feeAmount,
          balanceBefore: fundingBefore,
          balanceAfter: fundingAfter,
          note: `اعتماد طلب ${request.reference} — ${request.gameName} (رسوم خدمة ${formatMoney(request.feeAmount)} ج.م)`,
          operationId: `game-topup:${request.reference}:funding`,
          createdBy: adminId,
        }).onDuplicateKeyUpdate({ set: { requestId: request.id } });
        await tx.insert(transactions).values({
          userId: request.userId,
          reference: `GT-TX-${request.reference}`,
          type: "adjustment",
          amount: request.totalAmount,
          currency: "EGP",
          status: "approved",
          direction: "debit",
          note: `طلب شحن ألعاب ${request.reference}`,
          customerTitle: request.kind === "deposit" ? "إيداع 1xBet" : "شحن ألعاب",
          customerDescription: `خصم ${formatMoney(request.totalAmount)} ج.م لـ${request.kind === "deposit" ? "إيداع 1xBet" : `شحن ${request.quantity} ${request.gameName}`}، منها ${formatMoney(request.feeAmount)} ج.م رسوم`,
          source: "game_topup",
          balanceBefore: wallet.balance,
          balanceAfter,
        }).onDuplicateKeyUpdate({ set: { userId: request.userId } });
        await tx.update(gameTopupRequests).set({ status: "approved", rejectionReason: null, adminNote: input.adminNote?.trim() || request.adminNote, reviewedBy: adminId, reviewedAt: new Date() }).where(eq(gameTopupRequests.id, request.id));
        await notifyUser(tx, request.userId, `تم قبول ${kindLabel}`, `تم اعتماد الطلب ${request.reference} وخصم ${formatMoney(request.totalAmount)} ج.م (منها ${formatMoney(request.feeAmount)} ج.م رسوم). سيبدأ التنفيذ بعد التحقق من البيانات.`, `game-topup:${request.reference}:approved`);
      }
    } else if (input.status === "processing") {
      if (current !== "approved") throw new Error("ابدأ التنفيذ فقط بعد اعتماد الطلب");
      await tx.update(gameTopupRequests).set({ status: "processing", adminNote: input.adminNote?.trim() || request.adminNote }).where(eq(gameTopupRequests.id, request.id));
      await notifyUser(tx, request.userId, `جارٍ تنفيذ ${kindLabel}`, `طلبك ${request.reference} قيد التنفيذ لدى فريق الخدمة.`, `game-topup:${request.reference}:processing`);
    } else if (input.status === "completed") {
      if (current !== "approved" && current !== "processing") throw new Error("لا يمكن إكمال الطلب قبل اعتماده");
      const providerReference = input.providerReference?.trim();
      if (!providerReference || providerReference.length < 3) throw new Error("أدخل رقم العملية أو مرجع المزود قبل إعلان الاكتمال");
      await tx.update(gameTopupRequests).set({ status: "completed", providerReference, adminNote: input.adminNote?.trim() || request.adminNote, completedAt: new Date() }).where(eq(gameTopupRequests.id, request.id));
      await notifyUser(tx, request.userId, `تم تنفيذ ${kindLabel}`, `اكتمل طلب ${request.reference}. مرجع العملية: ${providerReference}.`, `game-topup:${request.reference}:completed`);
    } else {
      if (current !== "new") throw new Error("الطلب قيد المراجعة بالفعل أو تم اعتماده");
      await tx.update(gameTopupRequests).set({ status: "under_review", adminNote: input.adminNote?.trim() || request.adminNote }).where(eq(gameTopupRequests.id, request.id));
    }
    const [updated] = await tx.select().from(gameTopupRequests).where(eq(gameTopupRequests.id, request.id)).limit(1);
    return { duplicate: false, request: requestView(updated), message: "تم تحديث حالة الطلب بنجاح." };
  });
}

export async function getAdminGameTopupCatalog(): Promise<{ settings: { enabled: boolean; fundingBalance: string; feeEnabled: boolean; feeAmount: string; feeMin: string; feeMax: string }; games: GameTopupGameView[]; fundingEntries: GameTopupFundingEntryView[]; pendingCount: number; feesCollected: string }> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx: any) => {
    const settings = await ensureSettings(tx);
    const games = await tx.select().from(gameTopupGames).orderBy(asc(gameTopupGames.sortOrder), asc(gameTopupGames.id));
    const packages = await tx.select().from(gameTopupPackages).orderBy(asc(gameTopupPackages.sortOrder));
    const entries = await tx.select().from(gameTopupFundingEntries).orderBy(desc(gameTopupFundingEntries.createdAt)).limit(50);
    const [pending] = await tx.select({ total: sql<number>`COUNT(*)` }).from(gameTopupRequests).where(inArray(gameTopupRequests.status, getPendingRecentOperationStatuses("gameTopup") as GameTopupStatus[]));
    const [fees] = await tx.select({ total: sql<string>`COALESCE(SUM(${gameTopupRequests.feeAmount}), 0)` }).from(gameTopupRequests).where(sql`${gameTopupRequests.status} IN ('approved','processing','completed')`);
    return {
      settings: { enabled: Boolean(settings.enabled), fundingBalance: settings.fundingBalance, feeEnabled: Boolean(settings.feeEnabled), feeAmount: settings.feeAmount, feeMin: settings.feeMin, feeMax: settings.feeMax },
      games: games.map((game: typeof gameTopupGames.$inferSelect) => gameView(game, packages.filter((item: typeof gameTopupPackages.$inferSelect) => item.gameId === game.id), true)),
      fundingEntries: entries.map((entry: typeof gameTopupFundingEntries.$inferSelect) => ({
        id: entry.id,
        direction: entry.direction,
        amount: entry.amount,
        feeAmount: entry.feeAmount,
        balanceAfter: entry.balanceAfter,
        note: entry.note,
        createdAt: entry.createdAt,
      })),
      pendingCount: Number(pending?.total ?? 0),
      feesCollected: decimal(cents(String(fees?.total ?? "0.00")), 2),
    };
  });
}

function normalizeSlug(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  if (slug.length < 2) throw new Error("أدخل معرّفًا لاتينيًا للعبة من حرفين على الأقل");
  return slug;
}

export async function saveGameTopupGame(adminId: number, input: {
  id?: number;
  slug?: string;
  name: string;
  serviceType?: "topup" | "deposit_withdraw";
  currencyLabel: string;
  minQuantity: number;
  unitPrice: string;
  fields: GameTopupPlayerField[];
  sortOrder: number;
  isActive: boolean;
  depositFeeEnabled?: boolean;
  depositFeeAmount?: string;
  depositFeeMin?: string;
  depositFeeMax?: string;
  minDepositAmount?: string;
  minWithdrawAmount?: string;
  withdrawEnabled?: boolean;
  withdrawalInstructions?: string;
  cityLabel?: string;
  cityPlaceholder?: string;
  cityValue?: string;
  streetLabel?: string;
  streetPlaceholder?: string;
  streetValue?: string;
  withdrawalCodeLabel?: string;
  userIdFieldLabel?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new Error("اسم اللعبة يجب أن يكون بين حرفين و80 حرفًا");
  const currencyLabel = input.currencyLabel.trim();
  if (!currencyLabel || currencyLabel.length > 24) throw new Error("أدخل اسم عملة اللعبة");
  if (!Number.isInteger(input.minQuantity) || input.minQuantity < 1 || input.minQuantity > 1_000_000) throw new Error("الحد الأدنى للكمية غير صالح");
  const serviceType: "topup" | "deposit_withdraw" = input.serviceType === "deposit_withdraw" ? "deposit_withdraw" : "topup";
  const unit = serviceType === "topup" ? cents(input.unitPrice) : 0n;
  if (serviceType === "topup" && unit <= 0n) throw new Error("سعر الوحدة يجب أن يكون أكبر من صفر");
  const depositFeeAmount = input.depositFeeAmount?.trim() || "0.00";
  const depositFeeMin = input.depositFeeMin?.trim() || "0.00";
  const depositFeeMax = input.depositFeeMax?.trim() || "0.00";
  const minDepositAmount = input.minDepositAmount?.trim() || "50.00";
  const minWithdrawAmount = input.minWithdrawAmount?.trim() || "50.00";
  const cityValue = input.cityValue?.trim() ?? "";
  const streetValue = input.streetValue?.trim() ?? "";
  if (cents(depositFeeAmount) < 0n || cents(depositFeeMin) < 0n || cents(depositFeeMax) < 0n) throw new Error("رسوم الإيداع لا يمكن أن تكون سالبة");
  if (cents(depositFeeMax) > 0n && cents(depositFeeMax) < cents(depositFeeMin)) throw new Error("الحد الأعلى لرسوم الإيداع يجب ألا يقل عن الحد الأدنى");
  if (cents(minDepositAmount) < 0n || cents(minWithdrawAmount) < 0n) throw new Error("الحد الأدنى للإيداع والسحب لا يمكن أن يكون سالبًا");
  if (cityValue.length > 160 || streetValue.length > 240) throw new Error("نص المدينة أو الشارع الثابت أطول من الحد المسموح");
  const fields = input.fields.slice(0, MAX_PLAYER_FIELDS);
  if (!fields.length) throw new Error("أضف خانة بيانات واحدة على الأقل");
  const keys = new Set<string>();
  for (const field of fields) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(field.key)) throw new Error(`مفتاح الخانة ${field.key} غير صالح`);
    if (!field.label.trim() || field.label.length > 60) throw new Error("كل خانة تحتاج تسمية واضحة");
    if (keys.has(field.key)) throw new Error("لا يمكن تكرار مفتاح الخانة");
    keys.add(field.key);
  }
  const values = {
    name,
    serviceType,
    currencyLabel,
    minQuantity: input.minQuantity,
    unitPrice: input.unitPrice,
    fieldsJson: JSON.stringify(fields.map((field) => ({ ...field, label: field.label.trim(), placeholder: field.placeholder?.trim() || undefined }))),
    depositFeeEnabled: input.depositFeeEnabled !== false,
    depositFeeAmount,
    depositFeeMin,
    depositFeeMax,
    minDepositAmount,
    minWithdrawAmount,
    withdrawEnabled: input.withdrawEnabled !== false,
    withdrawalInstructions: input.withdrawalInstructions?.trim() || null,
    cityLabel: input.cityLabel?.trim() || "المدينة",
    cityPlaceholder: input.cityPlaceholder?.trim() || "أدخل المدينة",
    cityValue,
    streetLabel: input.streetLabel?.trim() || "الشارع",
    streetPlaceholder: input.streetPlaceholder?.trim() || "أدخل الشارع",
    streetValue,
    withdrawalCodeLabel: input.withdrawalCodeLabel?.trim() || "أدخل كود السحب",
    userIdFieldLabel: input.userIdFieldLabel?.trim() || "ID المستخدم",
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };
  if (input.id) {
    const [existing] = await db.select().from(gameTopupGames).where(eq(gameTopupGames.id, input.id)).limit(1);
    if (!existing) throw new Error("اللعبة غير موجودة");
    const slug = input.slug ? normalizeSlug(input.slug) : existing.slug;
    await db.update(gameTopupGames).set({ ...values, slug }).where(eq(gameTopupGames.id, input.id));
    return { id: input.id, message: "تم حفظ بيانات اللعبة" };
  }
  const slug = normalizeSlug(input.slug || name);
  const [duplicate] = await db.select({ id: gameTopupGames.id }).from(gameTopupGames).where(eq(gameTopupGames.slug, slug)).limit(1);
  if (duplicate) throw new Error("يوجد لعبة أخرى بنفس المعرّف");
  const inserted = await db.insert(gameTopupGames).values({ ...values, slug });
  const id = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId);
  return { id: id || null, message: "تمت إضافة اللعبة" };
}

export async function deleteGameTopupGame(gameId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx: any) => {
    const [game] = await tx.select().from(gameTopupGames).where(eq(gameTopupGames.id, gameId)).limit(1);
    if (!game) throw new Error("اللعبة غير موجودة");
    await tx.delete(gameTopupPackages).where(eq(gameTopupPackages.gameId, gameId));
    await tx.delete(gameTopupGames).where(eq(gameTopupGames.id, gameId));
    return { message: `تم حذف ${game.name}. تبقى طلباتها السابقة في السجل.` };
  });
}

export async function saveGameTopupPackage(input: { id?: number; gameId: number; label?: string; quantity: number; price: string; sortOrder: number; isActive: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10_000_000) throw new Error("كمية الباقة غير صالحة");
  if (cents(input.price) <= 0n) throw new Error("سعر الباقة يجب أن يكون أكبر من صفر");
  const [game] = await db.select({ id: gameTopupGames.id }).from(gameTopupGames).where(eq(gameTopupGames.id, input.gameId)).limit(1);
  if (!game) throw new Error("اللعبة غير موجودة");
  const values = { gameId: input.gameId, label: input.label?.trim() || null, quantity: input.quantity, price: input.price, sortOrder: input.sortOrder, isActive: input.isActive };
  if (input.id) {
    await db.update(gameTopupPackages).set(values).where(and(eq(gameTopupPackages.id, input.id), eq(gameTopupPackages.gameId, input.gameId)));
    return { id: input.id, message: "تم حفظ الباقة" };
  }
  const inserted = await db.insert(gameTopupPackages).values(values);
  return { id: Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId) || null, message: "تمت إضافة الباقة" };
}

export async function deleteGameTopupPackage(packageId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  await db.delete(gameTopupPackages).where(eq(gameTopupPackages.id, packageId));
  return { message: "تم حذف الباقة" };
}

export async function updateGameTopupSettings(input: { enabled: boolean; feeEnabled: boolean; feeAmount: string; feeMin: string; feeMax: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const fee = cents(input.feeAmount);
  const min = cents(input.feeMin);
  const max = cents(input.feeMax);
  if (fee < 0n || min < 0n) throw new Error("رسوم الخدمة لا يمكن أن تكون سالبة");
  if (max > 0n && max < min) throw new Error("الحد الأعلى للرسوم يجب ألا يقل عن الحد الأدنى");
  if (input.feeEnabled && fee < min) throw new Error("قيمة الرسوم أقل من الحد الأدنى المحدد");
  if (input.feeEnabled && max > 0n && fee > max) throw new Error("قيمة الرسوم أعلى من الحد الأعلى المحدد");
  return db.transaction(async (tx: any) => {
    await ensureSettings(tx);
    await tx.update(gameTopupSettings).set({ enabled: input.enabled, feeEnabled: input.feeEnabled, feeAmount: input.feeAmount, feeMin: input.feeMin, feeMax: input.feeMax }).where(eq(gameTopupSettings.id, SETTINGS_ID));
    return { enabled: input.enabled, message: input.enabled ? "تم حفظ إعدادات خدمة شحن الألعاب" : "تم إيقاف خدمة شحن الألعاب" };
  });
}
export async function addGameTopupFunding(adminId: number, input: { amount: string; source: string; operationId: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const amount = cents(input.amount);
  if (amount <= 0n) throw new Error("مبلغ التمويل يجب أن يكون أكبر من صفر");
  const source = input.source.trim();
  if (source.length < 2 || source.length > 200) throw new Error("أدخل مصدر التمويل");
  const operationId = input.operationId.trim();
  if (operationId.length < 12 || operationId.length > 80) throw new Error("مرجع عملية التمويل غير صالح");
  return db.transaction(async (tx: any) => {
    const [existing] = await tx.select().from(gameTopupFundingEntries).where(eq(gameTopupFundingEntries.operationId, operationId)).limit(1);
    if (existing) return { duplicate: true, amount: existing.amount, balance: existing.balanceAfter, message: "تم تسجيل عملية التمويل هذه من قبل." };
    const settings = await ensureSettings(tx);
    const before = settings.fundingBalance;
    const after = addDecimal(before, input.amount, 2);
    await tx.update(gameTopupSettings).set({ fundingBalance: after }).where(eq(gameTopupSettings.id, SETTINGS_ID));
    await tx.insert(gameTopupFundingEntries).values({ direction: "credit", amount: input.amount, feeAmount: "0.00", balanceBefore: before, balanceAfter: after, note: source, operationId, createdBy: adminId });
    return { duplicate: false, amount: input.amount, balance: after, message: `أضيف ${formatMoney(input.amount)} ج.م إلى محفظة تمويل شحن الألعاب.` };
  });
}

export async function saveGameTopupImage(gameId: number, dataUrl: string) {
  const image = decodePaymentImage(dataUrl);
  if (image.bytes.length > MAX_IMAGE_BYTES) throw new Error("حجم صورة اللعبة يجب ألا يتجاوز 1.5 ميجابايت");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [game] = await db.select().from(gameTopupGames).where(eq(gameTopupGames.id, gameId)).limit(1);
  if (!game) throw new Error("اللعبة غير موجودة");
  const extension = image.mime.split("/")[1];
  const uploaded = await storagePut(`game-topup/${game.slug}/${randomUUID()}.${extension}`, image.bytes, image.mime);
  await db.update(gameTopupGames).set({ imageUrl: uploaded.url }).where(eq(gameTopupGames.id, gameId));
  return { imageUrl: uploaded.url, message: "تم تحديث صورة اللعبة" };
}

export async function clearGameTopupImage(gameId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  await db.update(gameTopupGames).set({ imageUrl: null }).where(eq(gameTopupGames.id, gameId));
  return { message: "تمت إزالة صورة اللعبة" };
}
