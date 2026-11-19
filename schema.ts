import { boolean, decimal, index, int, longtext, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  /** Public immutable customer identifier. Stored as text to preserve leading zeroes. */
  customerId: varchar("customerId", { length: 10 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  emailNormalized: varchar("emailNormalized", { length: 320 }),
  givenName: varchar("givenName", { length: 100 }),
  fatherName: varchar("fatherName", { length: 100 }),
  phoneNumber: varchar("phoneNumber", { length: 20 }),
  phoneNormalized: varchar("phoneNormalized", { length: 20 }),
  phoneVerifiedAt: timestamp("phoneVerifiedAt"),
  birthDate: varchar("birthDate", { length: 10 }),
  governorate: varchar("governorate", { length: 40 }),
  nationalIdCiphertext: text("nationalIdCiphertext"),
  nationalIdLast4: varchar("nationalIdLast4", { length: 4 }),
  nationalIdFingerprint: varchar("nationalIdFingerprint", { length: 64 }),
  securityPinHash: varchar("securityPinHash", { length: 256 }),
  securityPinUpdatedAt: timestamp("securityPinUpdatedAt"),
  profileCompletedAt: timestamp("profileCompletedAt"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  status: mysqlEnum("status", ["active", "deleted"]).default("active").notNull(),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  lastOpenedAt: timestamp("lastOpenedAt"),
  appVersion: varchar("appVersion", { length: 32 }),
  appBuildNumber: varchar("appBuildNumber", { length: 48 }),
}, (table) => ({
  emailNormalizedUnique: uniqueIndex("users_email_normalized_unique").on(table.emailNormalized),
  phoneNormalizedUnique: uniqueIndex("users_phone_normalized_unique").on(table.phoneNormalized),
  nationalIdFingerprintUnique: uniqueIndex("users_national_id_fingerprint_unique").on(table.nationalIdFingerprint),
}));

export const accountVerifications = mysqlTable("account_verifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  nameSnapshot: text("nameSnapshot").notNull(),
  emailSnapshot: varchar("emailSnapshot", { length: 320 }),
  phoneNumberSnapshot: varchar("phoneNumberSnapshot", { length: 20 }).notNull(),
  birthDateSnapshot: varchar("birthDateSnapshot", { length: 10 }).notNull(),
  nationalIdLast4: varchar("nationalIdLast4", { length: 4 }).notNull(),
  nationalIdFingerprint: varchar("nationalIdFingerprint", { length: 64 }).notNull(),
  phoneFingerprint: varchar("phoneFingerprint", { length: 64 }).notNull(),
  idFrontFingerprint: varchar("idFrontFingerprint", { length: 64 }).notNull(),
  idBackFingerprint: varchar("idBackFingerprint", { length: 64 }).notNull(),
  selfieFingerprint: varchar("selfieFingerprint", { length: 64 }).notNull(),
  walletProfileFingerprint: varchar("walletProfileFingerprint", { length: 64 }).notNull(),
  idFrontCiphertext: longtext("idFrontCiphertext").notNull(),
  idFrontMimeType: varchar("idFrontMimeType", { length: 24 }).notNull(),
  idBackCiphertext: longtext("idBackCiphertext").notNull(),
  idBackMimeType: varchar("idBackMimeType", { length: 24 }).notNull(),
  selfieCiphertext: longtext("selfieCiphertext").notNull(),
  selfieMimeType: varchar("selfieMimeType", { length: 24 }).notNull(),
  walletProfileCiphertext: longtext("walletProfileCiphertext").notNull(),
  walletProfileMimeType: varchar("walletProfileMimeType", { length: 24 }).notNull(),
  rejectionReason: text("rejectionReason"),
  verificationMethod: varchar("verificationMethod", { length: 20 }),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  nationalIdFingerprintUnique: uniqueIndex("account_verifications_national_id_unique").on(table.nationalIdFingerprint),
  phoneFingerprintUnique: uniqueIndex("account_verifications_phone_unique").on(table.phoneFingerprint),
  idFrontFingerprintUnique: uniqueIndex("account_verifications_id_front_unique").on(table.idFrontFingerprint),
  idBackFingerprintUnique: uniqueIndex("account_verifications_id_back_unique").on(table.idBackFingerprint),
  selfieFingerprintUnique: uniqueIndex("account_verifications_selfie_unique").on(table.selfieFingerprint),
  walletProfileFingerprintUnique: uniqueIndex("account_verifications_wallet_profile_unique").on(table.walletProfileFingerprint),
  statusSubmittedIdx: index("account_verifications_status_submitted_idx").on(table.status, table.submittedAt),
}));

export const supportMessages = mysqlTable("support_messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  category: mysqlEnum("category", ["account", "freeze", "external_transaction"]).default("account").notNull(),
  senderRole: mysqlEnum("senderRole", ["user", "admin"]).notNull(),
  adminId: int("adminId"),
  body: text("body").notNull(),
  attachmentCiphertext: longtext("attachmentCiphertext"),
  attachmentMimeType: varchar("attachmentMimeType", { length: 24 }),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("support_messages_user_created_idx").on(table.userId, table.createdAt),
  userCategoryCreatedIdx: index("support_messages_user_category_created_idx").on(table.userId, table.category, table.createdAt),
  categoryCreatedIdx: index("support_messages_category_created_idx").on(table.category, table.createdAt),
  unreadIdx: index("support_messages_user_read_idx").on(table.userId, table.readAt),
}));

export const supportThreadStates = mysqlTable("support_thread_states", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  category: mysqlEnum("category", ["account", "freeze", "external_transaction"]).notNull(),
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  closedBy: int("closedBy"),
  closedAt: timestamp("closedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userCategoryUnique: uniqueIndex("support_thread_states_user_category_unique").on(table.userId, table.category),
  statusUpdatedIdx: index("support_thread_states_status_updated_idx").on(table.status, table.updatedAt),
}));

export const guestSupportTickets = mysqlTable("guest_support_tickets", {
  id: int("id").autoincrement().primaryKey(),
  ticketCode: varchar("ticketCode", { length: 24 }).notNull().unique(),
  displayName: varchar("displayName", { length: 120 }).notNull(),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 24 }),
  otpChallengeId: varchar("otpChallengeId", { length: 36 }),
  verifiedAt: timestamp("verifiedAt"),
  status: mysqlEnum("status", ["new", "pending_reply", "replied", "closed"]).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  closedAt: timestamp("closedAt"),
}, (table) => ({
  statusUpdatedIdx: index("guest_support_tickets_status_updated_idx").on(table.status, table.updatedAt),
  emailCreatedIdx: index("guest_support_tickets_email_created_idx").on(table.contactEmail, table.createdAt),
}));

export const guestSupportSessions = mysqlTable("guest_support_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ticketId: int("ticketId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  ticketExpiryIdx: index("guest_support_sessions_ticket_expiry_idx").on(table.ticketId, table.expiresAt),
}));

export const guestSupportMessages = mysqlTable("guest_support_messages", {
  id: int("id").autoincrement().primaryKey(),
  ticketId: int("ticketId").notNull(),
  senderRole: mysqlEnum("senderRole", ["guest", "admin"]).notNull(),
  adminId: int("adminId"),
  body: text("body").notNull(),
  attachmentCiphertext: longtext("attachmentCiphertext"),
  attachmentMimeType: varchar("attachmentMimeType", { length: 24 }),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  ticketCreatedIdx: index("guest_support_messages_ticket_created_idx").on(table.ticketId, table.createdAt),
  ticketReadIdx: index("guest_support_messages_ticket_read_idx").on(table.ticketId, table.readAt),
}));

export const externalTransferRequests = mysqlTable("external_transfer_requests", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 40 }).notNull().unique(),
  clientOperationId: varchar("clientOperationId", { length: 100 }).notNull().unique(),
  userId: int("userId").notNull(),
  countryCode: varchar("countryCode", { length: 4 }).notNull(),
  countryName: varchar("countryName", { length: 80 }).notNull(),
  currencyName: varchar("currencyName", { length: 80 }).notNull(),
  currencyCode: varchar("currencyCode", { length: 8 }).notNull(),
  foreignAmount: decimal("foreignAmount", { precision: 14, scale: 2 }),
  exchangeRate: decimal("exchangeRate", { precision: 14, scale: 6 }),
  egpEquivalent: decimal("egpEquivalent", { precision: 14, scale: 2 }),
  feeEgp: decimal("feeEgp", { precision: 14, scale: 2 }),
  pricingUpdatedAt: timestamp("pricingUpdatedAt"),
  status: mysqlEnum("status", ["new", "under_review", "awaiting_details", "approved", "completed", "rejected"]).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  rejectionReason: text("rejectionReason"),
}, (table) => ({
  userCreatedIdx: index("external_transfer_requests_user_created_idx").on(table.userId, table.createdAt),
  statusCreatedIdx: index("external_transfer_requests_status_created_idx").on(table.status, table.createdAt),
}));

export const accountVerificationOverrides = mysqlTable("account_verification_overrides", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  status: mysqlEnum("status", ["manual_verified", "revoked"]).notNull(),
  adminId: int("adminId").notNull(),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusUpdatedIdx: index("account_verification_overrides_status_updated_idx").on(table.status, table.updatedAt),
  adminUpdatedIdx: index("account_verification_overrides_admin_updated_idx").on(table.adminId, table.updatedAt),
}));

export const wallets = mysqlTable("wallets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  balance: decimal("balance", { precision: 14, scale: 2 }).default("0.00").notNull(),
  reservedWithdrawals: decimal("reservedWithdrawals", { precision: 14, scale: 2 }).default("0.00").notNull(),
  reservedOrders: decimal("reservedOrders", { precision: 14, scale: 2 }).default("0.00").notNull(),
  reservedTransfers: decimal("reservedTransfers", { precision: 14, scale: 2 }).default("0.00").notNull(),
  reservedSavings: decimal("reservedSavings", { precision: 14, scale: 2 }).default("0.00").notNull(),
  profitLoss: decimal("profitLoss", { precision: 14, scale: 2 }).default("0.00").notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export const transactions = mysqlTable("transactions", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["deposit", "withdrawal", "profit", "loss", "adjustment", "transfer", "fee"]).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled"]).default("approved").notNull(),
  note: text("note"),
  direction: mysqlEnum("direction", ["credit", "debit"]),
  customerTitle: varchar("customerTitle", { length: 40 }),
  customerDescription: varchar("customerDescription", { length: 160 }),
  source: varchar("source", { length: 40 }),
  balanceBefore: decimal("balanceBefore", { precision: 14, scale: 2 }),
  balanceAfter: decimal("balanceAfter", { precision: 14, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userIdx: index("transactions_user_idx").on(table.userId) }));
export const requests = mysqlTable("requests", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  userId: int("userId").notNull(),
	type: mysqlEnum("type", ["deposit", "withdrawal"]).notNull(),
	amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
	feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
	currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
		  paymentChannel: varchar("paymentChannel", { length: 40 }),
		  transferReference: varchar("transferReference", { length: 150 }),
		  receiptImageUrl: text("receiptImageUrl"),
		  destination: varchar("destination", { length: 180 }),
  paymentMethodId: varchar("paymentMethodId", { length: 20 }),
  /** JSON-encoded values for admin-defined method fields; null for legacy requests. */
  customFields: text("customFields"),
  clientOperationId: varchar("clientOperationId", { length: 80 }).unique(),
  payloadHash: varchar("payloadHash", { length: 64 }),
  senderReference: varchar("senderReference", { length: 150 }),
  submittedTransferReference: varchar("submittedTransferReference", { length: 150 }),
  transferNumberSnapshot: varchar("transferNumberSnapshot", { length: 120 }),
  payoutReference: varchar("payoutReference", { length: 150 }).unique(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "completed"]).default("pending").notNull(),
  note: text("note"),
  rejectionReason: text("rejectionReason"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ statusIdx: index("requests_status_idx").on(table.status), userIdx: index("requests_user_idx").on(table.userId), transferReferenceUnique: uniqueIndex("requests_transfer_reference_unique").on(table.transferReference) }));
export const moneyTransfers = mysqlTable("money_transfers", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  senderUserId: int("senderUserId").notNull(),
  recipientUserId: int("recipientUserId").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  note: text("note"),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled"]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  cancelledAt: timestamp("cancelledAt"),
  idempotencyKey: varchar("idempotencyKey", { length: 80 }).notNull(),
  payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idempotencyUnique: uniqueIndex("money_transfers_idempotency_unique").on(table.senderUserId, table.idempotencyKey),
  senderCreatedIdx: index("money_transfers_sender_created_idx").on(table.senderUserId, table.createdAt),
  recipientCreatedIdx: index("money_transfers_recipient_created_idx").on(table.recipientUserId, table.createdAt),
  statusCreatedIdx: index("money_transfers_status_created_idx").on(table.status, table.createdAt),
}));
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  operationId: varchar("operationId", { length: 100 }).notNull(),
  adminId: int("adminId").notNull(),
  targetUserId: int("targetUserId").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  balanceBefore: decimal("balanceBefore", { precision: 14, scale: 2 }).default("0.00").notNull(),
  balanceAfter: decimal("balanceAfter", { precision: 14, scale: 2 }).default("0.00").notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
	reason: text("reason").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ operationUnique: uniqueIndex("audit_operation_unique").on(table.operationId) }));

export const appSettings = mysqlTable("app_settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: text("value").notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const phoneVerificationRequests = mysqlTable("phone_verification_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  phoneNumber: varchar("phoneNumber", { length: 20 }).notNull(),
  phoneNormalized: varchar("phoneNormalized", { length: 20 }).notNull(),
  message: text("message"),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled"]).default("pending").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  reviewNote: text("reviewNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("phone_verification_user_created_idx").on(table.userId, table.createdAt),
  statusCreatedIdx: index("phone_verification_status_created_idx").on(table.status, table.createdAt),
  phoneIdx: index("phone_verification_phone_idx").on(table.phoneNormalized),
}));

export const userProfileAudits = mysqlTable("user_profile_audits", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull(),
  targetUserId: int("targetUserId").notNull(),
  changes: text("changes").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  targetCreatedIdx: index("user_profile_audit_target_created_idx").on(table.targetUserId, table.createdAt),
  adminCreatedIdx: index("user_profile_audit_admin_created_idx").on(table.adminId, table.createdAt),
}));

export const paymentMethods = mysqlTable("payment_methods", {
  id: varchar("id", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 40 }).notNull(),
  transferNumber: varchar("transferNumber", { length: 120 }),
  imageUrl: text("imageUrl"),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export const customerPaymentMethodAccess = mysqlTable("customer_payment_method_access", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  methodId: varchar("methodId", { length: 20 }).notNull(),
  depositEnabled: int("depositEnabled").notNull().default(1),
  withdrawalEnabled: int("withdrawalEnabled").notNull().default(1),
  updatedBy: int("updatedBy").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userMethodUnique: uniqueIndex("customer_payment_method_access_user_method_unique").on(table.userId, table.methodId),
  userIdx: index("customer_payment_method_access_user_idx").on(table.userId),
}));
export const accountStatusEvents = mysqlTable("account_status_events", {
  id: int("id").autoincrement().primaryKey(),
  targetUserId: int("targetUserId").notNull(),
  actorUserId: int("actorUserId").notNull(),
  actorType: mysqlEnum("actorType", ["user", "admin"]).notNull(),
  action: mysqlEnum("action", ["soft_delete", "restore"]).notNull(),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  targetCreatedIdx: index("account_status_events_target_created_idx").on(table.targetUserId, table.createdAt),
  actorCreatedIdx: index("account_status_events_actor_created_idx").on(table.actorUserId, table.createdAt),
}));
export const marketInstruments = mysqlTable("market_instruments", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 32 }).notNull().unique(),
  nameArabic: varchar("nameArabic", { length: 255 }).notNull(),
  assetClass: mysqlEnum("assetClass", ["egyptian_equity", "gold", "investment_fund"]).default("egyptian_equity").notNull(),
  exchange: varchar("exchange", { length: 32 }).notNull().default("EGX"),
  dataSource: varchar("dataSource", { length: 120 }).notNull(),
  dataLicense: varchar("dataLicense", { length: 255 }),
  active: int("active").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const marketQuotes = mysqlTable("market_quotes", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  lastPrice: decimal("lastPrice", { precision: 14, scale: 4 }).notNull(),
  change: decimal("change", { precision: 14, scale: 4 }).notNull().default("0"),
  changePercent: decimal("changePercent", { precision: 8, scale: 4 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  source: varchar("source", { length: 120 }).notNull(),
  isIndicative: int("isIndicative").notNull().default(0),
  quotedAt: timestamp("quotedAt").notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
}, (table) => ({ symbolTimeIdx: index("market_quotes_symbol_time_idx").on(table.symbol, table.quotedAt) }));

export const goldSettings = mysqlTable("gold_settings", {
  id: int("id").autoincrement().primaryKey(),
  enabled: int("enabled").notNull().default(0),
  buyFee: decimal("buyFee", { precision: 14, scale: 2 }).default("1.00").notNull(),
  sellFee: decimal("sellFee", { precision: 14, scale: 2 }).default("1.00").notNull(),
  buySpreadPerGram: decimal("buySpreadPerGram", { precision: 14, scale: 4 }).default("0.00").notNull(),
  sellSpreadPerGram: decimal("sellSpreadPerGram", { precision: 14, scale: 4 }).default("0.00").notNull(),
  makingChargePerGram: decimal("makingChargePerGram", { precision: 14, scale: 4 }).default("0.00").notNull(),
  minGrams: decimal("minGrams", { precision: 18, scale: 6 }).default("0.001000").notNull(),
  maxGrams: decimal("maxGrams", { precision: 18, scale: 6 }).default("1000.000000").notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const goldFundingWallets = mysqlTable("gold_funding_wallets", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull().unique(),
  name: varchar("name", { length: 100 }).default("محفظة تمويل الذهب").notNull(),
  cashBalance: decimal("cashBalance", { precision: 14, scale: 2 }).default("0.00").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const goldInventory = mysqlTable("gold_inventory", {
  id: int("id").autoincrement().primaryKey(),
  walletId: int("walletId").notNull(),
  karat: mysqlEnum("karat", ["24", "21", "18"]).notNull(),
  availableGrams: decimal("availableGrams", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  reservedGrams: decimal("reservedGrams", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ walletKaratUnique: uniqueIndex("gold_inventory_wallet_karat_unique").on(table.walletId, table.karat) }));

export const goldInventoryLedger = mysqlTable("gold_inventory_ledger", {
  id: int("id").autoincrement().primaryKey(),
  walletId: int("walletId").notNull(),
  adminId: int("adminId").notNull(),
  karat: mysqlEnum("karat", ["24", "21", "18"]).notNull(),
  direction: mysqlEnum("direction", ["credit", "debit"]).notNull(),
  grams: decimal("grams", { precision: 18, scale: 6 }).notNull(),
  cashAmount: decimal("cashAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  source: varchar("source", { length: 180 }).notNull(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 120 }).notNull().unique(),
  balanceAfterGrams: decimal("balanceAfterGrams", { precision: 18, scale: 6 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ walletKaratIdx: index("gold_inventory_ledger_wallet_karat_idx").on(table.walletId, table.karat, table.createdAt) }));

export const goldPriceSnapshots = mysqlTable("gold_price_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  source: varchar("source", { length: 120 }).notNull(),
  sourceSymbol: varchar("sourceSymbol", { length: 32 }).notNull(),
  ouncePrice: decimal("ouncePrice", { precision: 14, scale: 4 }).notNull(),
  gram24: decimal("gram24", { precision: 14, scale: 4 }).notNull(),
  gram21: decimal("gram21", { precision: 14, scale: 4 }).notNull(),
  gram18: decimal("gram18", { precision: 14, scale: 4 }).notNull(),
  bid: decimal("bid", { precision: 14, scale: 4 }),
  ask: decimal("ask", { precision: 14, scale: 4 }),
  quotedAt: timestamp("quotedAt").notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  isIndicative: int("isIndicative").notNull().default(1),
  rawPayload: longtext("rawPayload"),
}, (table) => ({ sourceQuotedIdx: index("gold_price_snapshots_source_quoted_idx").on(table.source, table.quotedAt) }));

export const goldPositions = mysqlTable("gold_positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  karat: mysqlEnum("karat", ["24", "21", "18"]).notNull(),
  grams: decimal("grams", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  averageCostPerGram: decimal("averageCostPerGram", { precision: 14, scale: 4 }).default("0.0000").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userKaratUnique: uniqueIndex("gold_positions_user_karat_unique").on(table.userId, table.karat) }));

export const goldOrders = mysqlTable("gold_orders", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 120 }).notNull().unique(),
  userId: int("userId").notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  karat: mysqlEnum("karat", ["24", "21", "18"]).notNull(),
  grams: decimal("grams", { precision: 18, scale: 6 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 14, scale: 4 }).notNull(),
  grossAmount: decimal("grossAmount", { precision: 14, scale: 2 }).notNull(),
  feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pending_review", "awaiting_execution", "executed", "delivered", "rejected", "cancelled"]).default("pending_review").notNull(),
  executionProvider: varchar("executionProvider", { length: 120 }),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
  reviewedBy: int("reviewedBy"),
}, (table) => ({ userCreatedIdx: index("gold_orders_user_created_idx").on(table.userId, table.createdAt), statusCreatedIdx: index("gold_orders_status_created_idx").on(table.status, table.createdAt) }));

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  clientOrderId: varchar("clientOrderId", { length: 100 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 120 }).notNull().unique(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  orderType: mysqlEnum("orderType", ["market", "limit"]).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
  limitPrice: decimal("limitPrice", { precision: 14, scale: 4 }),
  reservedAmount: decimal("reservedAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  status: mysqlEnum("status", ["draft", "submitted", "partially_filled", "filled", "rejected", "cancelled"]).default("draft").notNull(),
  broker: varchar("broker", { length: 120 }),
  brokerOrderId: varchar("brokerOrderId", { length: 150 }),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  submittedAt: timestamp("submittedAt"),
  filledAt: timestamp("filledAt"),
}, (table) => ({ userIdx: index("orders_user_idx").on(table.userId), brokerIdx: index("orders_broker_idx").on(table.brokerOrderId) }));

export const executions = mysqlTable("executions", {
  id: int("id").autoincrement().primaryKey(),
  executionId: varchar("executionId", { length: 150 }).notNull().unique(),
  orderId: int("orderId").notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
  price: decimal("price", { precision: 14, scale: 4 }).notNull(),
  fees: decimal("fees", { precision: 14, scale: 4 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  executedAt: timestamp("executedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull().default("0"),
  averagePrice: decimal("averagePrice", { precision: 14, scale: 4 }).notNull().default("0"),
  marketValue: decimal("marketValue", { precision: 14, scale: 4 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userSymbolUnique: uniqueIndex("positions_user_symbol_unique").on(table.userId, table.symbol) }));

export const cashLedger = mysqlTable("cash_ledger", {
  id: int("id").autoincrement().primaryKey(),
  entryReference: varchar("entryReference", { length: 120 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 120 }).notNull().unique(),
  userId: int("userId").notNull(),
  direction: mysqlEnum("direction", ["credit", "debit"]).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: decimal("balanceAfter", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  source: varchar("source", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "reversed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userIdx: index("cash_ledger_user_idx").on(table.userId) }));
export const savingsSettings = mysqlTable("savings_settings", {
  id: int("id").autoincrement().primaryKey(),
  minimumAmount: decimal("minimumAmount", { precision: 14, scale: 2 }).default("1000.00").notNull(),
  feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).default("1.00").notNull(),
  dailyRatePercent: decimal("dailyRatePercent", { precision: 8, scale: 4 }).default("0.0548").notNull(),
  monthlyRatePercent: decimal("monthlyRatePercent", { precision: 8, scale: 4 }).default("1.6667").notNull(),
  yearlyRatePercent: decimal("yearlyRatePercent", { precision: 8, scale: 4 }).default("20.0000").notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export const savingsSettingAudits = mysqlTable("savings_setting_audits", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull(),
  field: varchar("field", { length: 40 }).notNull(),
  oldValue: varchar("oldValue", { length: 40 }).notNull(),
  newValue: varchar("newValue", { length: 40 }).notNull(),
  changedAt: timestamp("changedAt").defaultNow().notNull(),
}, (table) => ({ fieldChangedIdx: index("savings_setting_audits_field_changed_idx").on(table.field, table.changedAt), adminChangedIdx: index("savings_setting_audits_admin_changed_idx").on(table.adminId, table.changedAt) }));
export const savingsPlans = mysqlTable("savings_plans", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  clientOperationId: varchar("clientOperationId", { length: 80 }).notNull().unique(),
  userId: int("userId").notNull(),
  financingWalletId: int("financingWalletId"),
  principalAmount: decimal("principalAmount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  frequency: mysqlEnum("frequency", ["daily", "monthly", "yearly"]).notNull(),
  ratePercent: decimal("ratePercent", { precision: 8, scale: 4 }).notNull(),
  ratePpm: int("ratePpm").default(0).notNull(),
  feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).default("1.00").notNull(),
  status: mysqlEnum("status", ["pending_approval", "active", "rejected", "completed", "refunded", "cancelled"]).default("pending_approval").notNull(),
  startAt: timestamp("startAt"),
  refundEligibleAt: timestamp("refundEligibleAt"),
  nextPayoutAt: timestamp("nextPayoutAt"),
  nextPayoutAttemptAt: timestamp("nextPayoutAttemptAt"),
  approvedBy: int("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  cancelledAt: timestamp("cancelledAt"),
  refundedAt: timestamp("refundedAt"),
  refundReference: varchar("refundReference", { length: 120 }),
  rejectionReason: text("rejectionReason"),
  lastPayoutAt: timestamp("lastPayoutAt"),
  totalAccrued: decimal("totalAccrued", { precision: 14, scale: 4 }).default("0.0000").notNull(),
  totalPaid: decimal("totalPaid", { precision: 14, scale: 2 }).default("0.00").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdx: index("savings_plans_user_idx").on(table.userId),
  financingWalletIdx: index("savings_plans_financing_wallet_idx").on(table.financingWalletId),
  statusIdx: index("savings_plans_status_idx").on(table.status),
  nextPayoutIdx: index("savings_plans_next_payout_idx").on(table.status, table.nextPayoutAt),
  payoutAttemptIdx: index("savings_plans_payout_attempt_idx").on(table.status, table.nextPayoutAttemptAt),
}));
export const savingsPayouts = mysqlTable("savings_payouts", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("planId").notNull(),
  userId: int("userId").notNull(),
  periodKey: varchar("periodKey", { length: 40 }).notNull(),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  expectedAmount: decimal("expectedAmount", { precision: 14, scale: 4 }).notNull(),
  paidAmount: decimal("paidAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  status: mysqlEnum("status", ["blocked", "paid"]).default("blocked").notNull(),
  blockReason: text("blockReason"),
  transactionReference: varchar("transactionReference", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  paidAt: timestamp("paidAt"),
}, (table) => ({
  planPeriodUnique: uniqueIndex("savings_payouts_plan_period_unique").on(table.planId, table.periodKey),
  userIdx: index("savings_payouts_user_idx").on(table.userId, table.createdAt),
}));
export const savingsFinancingWallets = mysqlTable("savings_financing_wallets", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull().unique(),
  name: varchar("name", { length: 80 }).default("محفظة تمويل الإدخار").notNull(),
  balance: decimal("balance", { precision: 14, scale: 2 }).default("0.00").notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export const savingsFinancingEntries = mysqlTable("savings_financing_entries", {
  id: int("id").autoincrement().primaryKey(),
  walletId: int("walletId").notNull(),
  adminId: int("adminId").notNull(),
  adminName: varchar("adminName", { length: 160 }).notNull(),
  savingsPlanId: int("savingsPlanId"),
  customerUserId: int("customerUserId"),
  customerName: varchar("customerName", { length: 160 }),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull().unique(),
  type: mysqlEnum("type", ["manual_funding", "savings_principal", "savings_profit", "savings_refund"]).notNull(),
  direction: mysqlEnum("direction", ["credit", "debit"]).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  source: varchar("source", { length: 200 }).notNull(),
  balanceBefore: decimal("balanceBefore", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: decimal("balanceAfter", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  walletCreatedIdx: index("savings_financing_entries_wallet_created_idx").on(table.walletId, table.createdAt),
  planIdx: index("savings_financing_entries_plan_idx").on(table.savingsPlanId),
  typeCreatedIdx: index("savings_financing_entries_type_created_idx").on(table.type, table.createdAt),
}));
export const paymentTransfers = mysqlTable("payment_transfers", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("requestId"),
  provider: varchar("provider", { length: 80 }).notNull(),
  providerReference: varchar("providerReference", { length: 150 }).notNull().unique(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EGP").notNull(),
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull(),
  status: mysqlEnum("status", ["received", "verified", "failed", "reversed"]).default("received").notNull(),
  verifiedBy: int("verifiedBy"),
  verifiedAt: timestamp("verifiedAt"),
  rawPayload: text("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const coinSettings = mysqlTable("coin_settings", {
  id: int("id").primaryKey(),
  buyPrice: decimal("buyPrice", { precision: 14, scale: 2 }).default("50.00").notNull(),
  sellPrice: decimal("sellPrice", { precision: 14, scale: 2 }).default("50.00").notNull(),
  buyFee: decimal("buyFee", { precision: 14, scale: 2 }).default("1.00").notNull(),
  sellFee: decimal("sellFee", { precision: 14, scale: 2 }).default("1.00").notNull(),
  transferMinimum: decimal("transferMinimum", { precision: 14, scale: 6 }).default("2.000000").notNull(),
  buyFeeEnabled: int("buyFeeEnabled").default(1).notNull(),
  sellFeeEnabled: int("sellFeeEnabled").default(1).notNull(),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const coinTreasuries = mysqlTable("coin_treasuries", {
  id: int("id").primaryKey(),
  totalCoins: decimal("totalCoins", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  availableCoins: decimal("availableCoins", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  reservedCoins: decimal("reservedCoins", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  buyCashBalance: decimal("buyCashBalance", { precision: 14, scale: 2 }).default("0.00").notNull(),
  sellFundingBalance: decimal("sellFundingBalance", { precision: 14, scale: 2 }).default("0.00").notNull(),
  reservedSellCash: decimal("reservedSellCash", { precision: 14, scale: 2 }).default("0.00").notNull(),
  totalBuyCollected: decimal("totalBuyCollected", { precision: 14, scale: 2 }).default("0.00").notNull(),
  totalSellPaid: decimal("totalSellPaid", { precision: 14, scale: 2 }).default("0.00").notNull(),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const coinWallets = mysqlTable("coin_wallets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  balance: decimal("balance", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  reserved: decimal("reserved", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const coinOrders = mysqlTable("coin_orders", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 120 }).notNull().unique(),
  userId: int("userId").notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 14, scale: 2 }).notNull(),
  grossAmount: decimal("grossAmount", { precision: 14, scale: 2 }).notNull(),
  feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled"]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userCreatedIdx: index("coin_orders_user_created_idx").on(table.userId, table.createdAt), statusCreatedIdx: index("coin_orders_status_created_idx").on(table.status, table.createdAt) }));

export const coinTransfers = mysqlTable("coin_transfers", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 120 }).notNull().unique(),
  senderUserId: int("senderUserId").notNull(),
  recipientUserId: int("recipientUserId").notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled"]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ senderCreatedIdx: index("coin_transfers_sender_created_idx").on(table.senderUserId, table.createdAt), recipientCreatedIdx: index("coin_transfers_recipient_created_idx").on(table.recipientUserId, table.createdAt), statusCreatedIdx: index("coin_transfers_status_created_idx").on(table.status, table.createdAt) }));

export const coinLedgerEntries = mysqlTable("coin_ledger_entries", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 120 }).notNull().unique(),
  adminId: int("adminId"),
  userId: int("userId"),
  kind: mysqlEnum("kind", ["inventory", "buy_cash", "sell_funding", "transfer", "admin_adjustment", "trade"]).notNull(),
  direction: mysqlEnum("direction", ["credit", "debit"]).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  source: varchar("source", { length: 200 }).notNull(),
  balanceAfterQuantity: decimal("balanceAfterQuantity", { precision: 18, scale: 6 }).default("0.000000").notNull(),
  balanceAfterAmount: decimal("balanceAfterAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ kindCreatedIdx: index("coin_ledger_kind_created_idx").on(table.kind, table.createdAt), userCreatedIdx: index("coin_ledger_user_created_idx").on(table.userId, table.createdAt) }));

export const coinPriceAudits = mysqlTable("coin_price_audits", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull(),
  previousBuyPrice: decimal("previousBuyPrice", { precision: 14, scale: 2 }).notNull(),
  newBuyPrice: decimal("newBuyPrice", { precision: 14, scale: 2 }).notNull(),
  previousSellPrice: decimal("previousSellPrice", { precision: 14, scale: 2 }).notNull(),
  newSellPrice: decimal("newSellPrice", { precision: 14, scale: 2 }).notNull(),
  reason: varchar("reason", { length: 240 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ createdIdx: index("coin_price_audits_created_idx").on(table.createdAt) }));

export const phoneChangeRequests = mysqlTable("phone_change_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  newPhoneNumber: varchar("newPhoneNumber", { length: 20 }).notNull(),
  newPhoneNormalized: varchar("newPhoneNormalized", { length: 20 }).notNull(),
  pendingPhoneNormalized: varchar("pendingPhoneNormalized", { length: 20 }),
  idFrontCiphertext: longtext("idFrontCiphertext").notNull(),
  idFrontMimeType: varchar("idFrontMimeType", { length: 24 }).notNull(),
  idBackCiphertext: longtext("idBackCiphertext").notNull(),
  idBackMimeType: varchar("idBackMimeType", { length: 24 }).notNull(),
  selfieCiphertext: longtext("selfieCiphertext").notNull(),
  selfieMimeType: varchar("selfieMimeType", { length: 24 }).notNull(),
  walletProfileCiphertext: longtext("walletProfileCiphertext").notNull(),
  walletProfileMimeType: varchar("walletProfileMimeType", { length: 24 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled"]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("phone_change_user_created_idx").on(table.userId, table.createdAt),
  statusCreatedIdx: index("phone_change_status_created_idx").on(table.status, table.createdAt),
  pendingPhoneUnique: uniqueIndex("phone_change_pending_phone_unique").on(table.pendingPhoneNormalized),
}));

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  createdBy: int("createdBy"),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  type: varchar("type", { length: 40 }).notNull(),
  operationId: varchar("operationId", { length: 120 }),
  deliveredAt: timestamp("deliveredAt"),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userIdx: index("notifications_user_idx").on(table.userId), operationUnique: uniqueIndex("notifications_user_operation_unique").on(table.userId, table.operationId) }));
export const userEmailDeliveries = mysqlTable("user_email_deliveries", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  adminId: int("adminId").notNull(),
  userId: int("userId").notNull(),
  toEmail: varchar("toEmail", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 200 }).notNull(),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  sentAt: timestamp("sentAt"),
}, (table) => ({ userCreatedIdx: index("user_email_deliveries_user_created_idx").on(table.userId, table.createdAt), adminCreatedIdx: index("user_email_deliveries_admin_created_idx").on(table.adminId, table.createdAt) }));
export const pushTokens = mysqlTable("push_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 512 }).notNull().unique(),
  provider: varchar("provider", { length: 32 }).notNull().default("expo"),
  platform: varchar("platform", { length: 24 }).notNull(),
  enabled: int("enabled").notNull().default(1),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("push_tokens_user_idx").on(table.userId) }));

export const pushDeliveries = mysqlTable("push_deliveries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  operationId: varchar("operationId", { length: 120 }).notNull(),
  token: varchar("token", { length: 512 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed", "unknown"]).default("pending").notNull(),
  providerMessageId: varchar("providerMessageId", { length: 180 }),
  error: text("error"),
  attemptCount: int("attemptCount").default(0).notNull(),
  lastAttemptAt: timestamp("lastAttemptAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  sentAt: timestamp("sentAt"),
}, (table) => ({ operationTokenUnique: uniqueIndex("push_deliveries_operation_token_unique").on(table.operationId, table.token, table.userId), userIdx: index("push_deliveries_user_idx").on(table.userId) }));

export const brokerEvents = mysqlTable("broker_events", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 80 }).notNull(),
  eventId: varchar("eventId", { length: 180 }).notNull().unique(),
  eventType: varchar("eventType", { length: 80 }).notNull(),
  brokerOrderId: varchar("brokerOrderId", { length: 150 }),
  payload: text("payload").notNull(),
  status: mysqlEnum("status", ["received", "processed", "rejected"]).default("received").notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
}, (table) => ({ providerOrderIdx: index("broker_events_provider_order_idx").on(table.provider, table.brokerOrderId) }));

/** Games offered by the in-app top-up service. Managed entirely from the admin panel. */
export const gameTopupGames = mysqlTable("game_topup_games", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  /** topup = packages/custom quantity, deposit_withdraw = 1xBet-style cashier service. */
  serviceType: mysqlEnum("serviceType", ["topup", "deposit_withdraw"]).default("topup").notNull(),
  currencyLabel: varchar("currencyLabel", { length: 24 }).default("جوهرة").notNull(),
  imageUrl: text("imageUrl"),
  minQuantity: int("minQuantity").default(1).notNull(),
  /** EGP price for one unit, used to price a custom quantity. Packages keep their own fixed price. */
  unitPrice: decimal("unitPrice", { precision: 12, scale: 4 }).default("0.0000").notNull(),
  /** JSON array of player fields: [{ key, label, placeholder, required }] */
  fieldsJson: text("fieldsJson"),
  depositFeeEnabled: boolean("depositFeeEnabled").default(true).notNull(),
  depositFeeAmount: decimal("depositFeeAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  depositFeeMin: decimal("depositFeeMin", { precision: 14, scale: 2 }).default("0.00").notNull(),
  depositFeeMax: decimal("depositFeeMax", { precision: 14, scale: 2 }).default("0.00").notNull(),
  /** Independent minimums for 1xBet-style cashier services. */
  minDepositAmount: decimal("minDepositAmount", { precision: 14, scale: 2 }).default("50.00").notNull(),
  minWithdrawAmount: decimal("minWithdrawAmount", { precision: 14, scale: 2 }).default("50.00").notNull(),
  withdrawEnabled: boolean("withdrawEnabled").default(true).notNull(),
  withdrawalInstructions: text("withdrawalInstructions"),
  cityLabel: varchar("cityLabel", { length: 60 }).default("المدينة").notNull(),
  cityPlaceholder: varchar("cityPlaceholder", { length: 120 }).default("أدخل المدينة").notNull(),
  cityValue: varchar("cityValue", { length: 160 }).default("").notNull(),
  streetLabel: varchar("streetLabel", { length: 60 }).default("الشارع").notNull(),
  streetPlaceholder: varchar("streetPlaceholder", { length: 120 }).default("أدخل الشارع").notNull(),
  streetValue: varchar("streetValue", { length: 240 }).default("").notNull(),
  withdrawalCodeLabel: varchar("withdrawalCodeLabel", { length: 80 }).default("أدخل كود السحب").notNull(),
  userIdFieldLabel: varchar("userIdFieldLabel", { length: 60 }).default("ID المستخدم").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const gameTopupPackages = mysqlTable("game_topup_packages", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  label: varchar("label", { length: 80 }),
  quantity: int("quantity").notNull(),
  price: decimal("price", { precision: 14, scale: 2 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ gameIdx: index("game_topup_packages_game_idx").on(table.gameId) }));

export const gameTopupRequests = mysqlTable("game_topup_requests", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  userId: int("userId").notNull(),
  gameId: int("gameId").notNull(),
  gameName: varchar("gameName", { length: 80 }).notNull(),
  kind: mysqlEnum("kind", ["topup", "deposit", "withdraw"]).default("topup").notNull(),
  packageId: int("packageId"),
  packageLabel: varchar("packageLabel", { length: 80 }),
  quantity: int("quantity").notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 4 }).notNull(),
  /** Shipping price before the service fee. */
  subtotalAmount: decimal("subtotalAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  /** Service fee charged on top of the shipping price. */
  feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  /** JSON array of the submitted player fields with their labels: [{ key, label, value }] */
  playerDataJson: text("playerDataJson").notNull(),
  city: varchar("city", { length: 160 }),
  street: varchar("street", { length: 240 }),
  withdrawalCode: varchar("withdrawalCode", { length: 160 }),
  status: mysqlEnum("status", ["new", "under_review", "approved", "processing", "completed", "rejected", "cancelled"]).default("new").notNull(),
  adminNote: text("adminNote"),
  rejectionReason: text("rejectionReason"),
  providerReference: varchar("providerReference", { length: 150 }),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  completedAt: timestamp("completedAt"),
  idempotencyKey: varchar("idempotencyKey", { length: 80 }).notNull().unique(),
  payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx: index("game_topup_requests_status_idx").on(table.status),
  userIdx: index("game_topup_requests_user_idx").on(table.userId),
  createdIdx: index("game_topup_requests_created_idx").on(table.createdAt),
}));

/** Single-row configuration and the dedicated game top-up funding wallet. */
export const gameTopupSettings = mysqlTable("game_topup_settings", {
  id: int("id").primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  fundingBalance: decimal("fundingBalance", { precision: 14, scale: 2 }).default("0.00").notNull(),
  feeEnabled: boolean("feeEnabled").default(true).notNull(),
  feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).default("5.00").notNull(),
  feeMin: decimal("feeMin", { precision: 14, scale: 2 }).default("0.00").notNull(),
  feeMax: decimal("feeMax", { precision: 14, scale: 2 }).default("100.00").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const gameTopupFundingEntries = mysqlTable("game_topup_funding_entries", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("requestId"),
  direction: mysqlEnum("direction", ["credit", "debit"]).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  /** Service-fee portion included in this entry, for reports. */
  feeAmount: decimal("feeAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  balanceBefore: decimal("balanceBefore", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: decimal("balanceAfter", { precision: 14, scale: 2 }).notNull(),
  note: varchar("note", { length: 255 }),
  operationId: varchar("operationId", { length: 80 }).notNull().unique(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ requestIdx: index("game_topup_funding_request_idx").on(table.requestId) }));

export type User = Omit<typeof users.$inferSelect, "governorate"> & { governorate?: string | null };
export type InsertUser = Omit<typeof users.$inferInsert, "customerId"> & { customerId?: string };
export type Wallet = typeof wallets.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Request = typeof requests.$inferSelect;

export { authChallenges, authIdentities, authPasswordCredentials, authEmailChallenges } from "./auth-schema";


export const globalUiButtonVisibility = mysqlTable("ui_button_visibility_global", {
  id: int("id").autoincrement().primaryKey(),
  surface: mysqlEnum("surface", ["home", "wallet"]).notNull(),
  buttonId: varchar("buttonId", { length: 64 }).notNull(),
  visible: boolean("visible").default(true).notNull(),
  reason: text("reason"),
  updatedBy: int("updatedBy").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  surfaceButtonUnique: uniqueIndex("ui_button_global_surface_button_unique").on(table.surface, table.buttonId),
  updatedByIdx: index("ui_button_global_updated_by_idx").on(table.updatedBy, table.updatedAt),
}));

export const userUiButtonVisibility = mysqlTable("ui_button_visibility_user", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  surface: mysqlEnum("surface", ["home", "wallet"]).notNull(),
  buttonId: varchar("buttonId", { length: 64 }).notNull(),
  mode: mysqlEnum("mode", ["visible", "hidden"]).notNull(),
  reason: text("reason"),
  updatedBy: int("updatedBy").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userSurfaceButtonUnique: uniqueIndex("ui_button_user_surface_button_unique").on(table.userId, table.surface, table.buttonId),
  userUpdatedIdx: index("ui_button_user_updated_idx").on(table.userId, table.updatedAt),
}));

export const uiButtonVisibilityAudit = mysqlTable("ui_button_visibility_audit", {
  id: int("id").autoincrement().primaryKey(),
  actorId: int("actorId").notNull(),
  targetUserId: int("targetUserId"),
  surface: mysqlEnum("surface", ["home", "wallet"]).notNull(),
  buttonId: varchar("buttonId", { length: 64 }).notNull(),
  action: mysqlEnum("action", ["shown", "hidden", "inherit"]).notNull(),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  targetCreatedIdx: index("ui_button_audit_target_created_idx").on(table.targetUserId, table.createdAt),
  actorCreatedIdx: index("ui_button_audit_actor_created_idx").on(table.actorId, table.createdAt),
}));
