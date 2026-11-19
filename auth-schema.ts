import {
  mysqlTable,
  mysqlEnum,
  text,
  timestamp,
  varchar,
  index,
  int,
} from "drizzle-orm/mysql-core";

/** Opaque, short-lived and single-use Google challenges retained for historical compatibility. */
export const authChallenges = mysqlTable(
  "auth_challenges",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    purpose: mysqlEnum("purpose", ["google_state", "google_handoff"]).notNull(),
    payload: text("payload").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    expiryIdx: index("auth_challenges_expiry_idx").on(table.expiresAt),
  }),
);

/** Historical provider identities remain intact; manual sign-in uses users.openId directly. */
export const authIdentities = mysqlTable(
  "auth_identities",
  {
    subject: varchar("subject", { length: 255 }).primaryKey(),
    userId: int("userId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({ userIdx: index("auth_identities_user_idx").on(table.userId) }),
);

/** Password hashes and verification timestamps are isolated from user/profile query results. */
export const authPasswordCredentials = mysqlTable("auth_password_credentials", {
  userId: int("userId").primaryKey(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  phoneVerifiedAt: timestamp("phoneVerifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Hashed one-time email codes and one-time grants; never stores a raw OTP or password. */
export const authEmailChallenges = mysqlTable(
  "auth_email_challenges",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    purpose: mysqlEnum("purpose", ["register", "password_reset", "account_support", "guest_support"]).notNull(),
    userId: int("userId"),
    phoneNormalized: varchar("phoneNormalized", { length: 20 }),
    codeHash: varchar("codeHash", { length: 64 }).notNull(),
    attemptCount: int("attemptCount").default(0).notNull(),
    codeExpiresAt: timestamp("codeExpiresAt").notNull(),
    codeConsumedAt: timestamp("codeConsumedAt"),
    grantHash: varchar("grantHash", { length: 64 }),
    grantExpiresAt: timestamp("grantExpiresAt"),
    grantConsumedAt: timestamp("grantConsumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    emailPurposeIdx: index("auth_email_challenges_email_purpose_idx").on(
      table.email,
      table.purpose,
      table.createdAt,
    ),
    expiryIdx: index("auth_email_challenges_expiry_idx").on(table.codeExpiresAt),
    userIdx: index("auth_email_challenges_user_idx").on(table.userId),
  }),
);

/** Short-lived support-only bearer grants for owners of soft-deleted accounts. */
export const authSupportSessions = mysqlTable("auth_support_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userExpiryIdx: index("auth_support_sessions_user_expiry_idx").on(table.userId, table.expiresAt),
}));

/** Device login challenges are short-lived, single-use and never contain a PIN. */
export const authLoginChallenges = mysqlTable("auth_login_challenges", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: int("userId").notNull(),
  challengeHash: varchar("challengeHash", { length: 64 }).notNull().unique(),
  deviceId: varchar("deviceId", { length: 128 }).notNull(),
  deviceName: varchar("deviceName", { length: 160 }),
  platform: varchar("platform", { length: 32 }),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userExpiryIdx: index("auth_login_challenges_user_expiry_idx").on(table.userId, table.expiresAt),
}));
/** Server-side registry for manually issued sessions, enabling device trust and remote logout. */
export const authDeviceSessions = mysqlTable("auth_device_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  deviceId: varchar("deviceId", { length: 128 }).notNull(),
  deviceName: varchar("deviceName", { length: 160 }),
  platform: varchar("platform", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(),
  trustedAt: timestamp("trustedAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt"),
  revokeReason: varchar("revokeReason", { length: 120 }),
}, (table) => ({
  userActivityIdx: index("auth_device_sessions_user_activity_idx").on(table.userId, table.lastActivityAt),
  deviceIdx: index("auth_device_sessions_user_device_idx").on(table.userId, table.deviceId),
}));
