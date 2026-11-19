import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Independent staging area: an entry here is NOT an authenticated users row. */
export const adminCreatedAccounts = mysqlTable("admin_created_accounts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  phoneNumber: varchar("phoneNumber", { length: 20 }),
  state: mysqlEnum("state", ["draft", "verification_required", "active", "suspended"]).notNull(),
  suspendedFrom: mysqlEnum("suspendedFrom", ["draft", "verification_required"]),
  createdById: int("createdById").notNull(),
  createdByName: varchar("createdByName", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date", fsp: 3 }).notNull(),
  identityEvidenceRef: varchar("identityEvidenceRef", { length: 120 }),
  identityReviewedById: int("identityReviewedById"),
  identityReviewedByName: varchar("identityReviewedByName", { length: 160 }),
  identityReviewedAt: timestamp("identityReviewedAt", { mode: "date", fsp: 3 }),
  invitationHash: varchar("invitationHash", { length: 64 }),
  invitationExpiresAt: timestamp("invitationExpiresAt", { mode: "date", fsp: 3 }),
  invitationConsumedAt: timestamp("invitationConsumedAt", { mode: "date", fsp: 3 }),
  emailVerifiedAt: timestamp("emailVerifiedAt", { mode: "date", fsp: 3 }),
  userId: int("userId"),
  customerId: varchar("customerId", { length: 10 }),
}, (table) => ({
  emailUnique: uniqueIndex("admin_created_accounts_email_uq").on(table.email),
  invitationUnique: uniqueIndex("admin_created_accounts_invitation_uq").on(table.invitationHash),
  userUnique: uniqueIndex("admin_created_accounts_user_uq").on(table.userId),
  createdIdx: index("admin_created_accounts_created_idx").on(table.createdAt),
}));

export const adminCreatedAccountEvents = mysqlTable("admin_created_account_events", {
  id: int("id").autoincrement().primaryKey(),
  requestId: varchar("requestId", { length: 36 }).notNull(),
  actorId: int("actorId"),
  actorName: varchar("actorName", { length: 160 }).notNull(),
  event: varchar("event", { length: 40 }).notNull(),
  details: text("details"),
  createdAt: timestamp("createdAt", { mode: "date", fsp: 3 }).notNull(),
}, (table) => ({ requestIdx: index("admin_created_account_events_request_idx").on(table.requestId, table.id) }));

/** Direct administrative accounts; unverified email is never represented as verified. */
export const adminImmediateAccounts = mysqlTable("admin_immediate_accounts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  createdById: int("createdById").notNull(),
  createdByName: varchar("createdByName", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date", fsp: 3 }).notNull(),
  firstLoginAt: timestamp("firstLoginAt", { mode: "date", fsp: 3 }),
  passwordChangedAt: timestamp("passwordChangedAt", { mode: "date", fsp: 3 }),
  failedLoginAttempts: int("failedLoginAttempts").notNull().default(0),
  loginLockedUntil: timestamp("loginLockedUntil", { mode: "date", fsp: 3 }),
  challengeHash: varchar("challengeHash", { length: 64 }),
  challengeExpiresAt: timestamp("challengeExpiresAt", { mode: "date", fsp: 3 }),
}, (table) => ({
  userUnique: uniqueIndex("admin_immediate_accounts_user_uq").on(table.userId),
  challengeUnique: uniqueIndex("admin_immediate_accounts_challenge_uq").on(table.challengeHash),
  createdIdx: index("admin_immediate_accounts_created_idx").on(table.createdAt),
}));
