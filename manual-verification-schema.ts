import { index, int, mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

/** No plaintext codes or grants. Each row is also an immutable creation/use/revocation audit record. */
export const manualVerificationCodes = mysqlTable("manual_verification_codes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  purpose: mysqlEnum("purpose", ["register", "password_reset"]).notNull(),
  userId: int("userId"),
  phoneNormalized: varchar("phoneNormalized", { length: 20 }),
  codeHash: varchar("codeHash", { length: 64 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  maxAttempts: int("maxAttempts").notNull(),
  attemptCount: int("attemptCount").default(0).notNull(),
  issuedBy: int("issuedBy").notNull(),
  issuedByName: varchar("issuedByName", { length: 255 }).notNull(),
  ownershipMethod: varchar("ownershipMethod", { length: 40 }).notNull(),
  ownershipCaseRef: varchar("ownershipCaseRef", { length: 80 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  usedAt: timestamp("usedAt"),
  lockedAt: timestamp("lockedAt"),
  revokedAt: timestamp("revokedAt"),
  revokedBy: int("revokedBy"),
  revokedByName: varchar("revokedByName", { length: 255 }),
  revokeReason: varchar("revokeReason", { length: 24 }),
}, (table) => ({
  emailPurposeIdx: index("manual_verification_scope_idx").on(table.email, table.purpose, table.createdAt),
  createdIdx: index("manual_verification_created_idx").on(table.createdAt),
}));
