import { index, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

// Include this file in the single consolidated Drizzle migration before deploying
// the guest-support changes. These tables do not modify existing conversations.
export const guestSupportMessageOperations = mysqlTable("guest_support_message_operations", {
  id: int("id").autoincrement().primaryKey(),
  ticketId: int("ticketId").notNull(),
  senderRole: mysqlEnum("senderRole", ["guest", "admin"]).notNull(),
  operationId: varchar("operationId", { length: 100 }).notNull(),
  payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  messageId: int("messageId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  operationUnique: uniqueIndex("guest_support_message_operation_unique").on(table.ticketId, table.senderRole, table.operationId),
}));

export const guestSupportAuditEvents = mysqlTable("guest_support_audit_events", {
  id: int("id").autoincrement().primaryKey(),
  ticketId: int("ticketId").notNull(),
  adminId: int("adminId").notNull(),
  action: mysqlEnum("action", ["reply", "status_change"]).notNull(),
  previousStatus: varchar("previousStatus", { length: 24 }).notNull(),
  newStatus: varchar("newStatus", { length: 24 }).notNull(),
  messageId: int("messageId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  ticketCreatedIdx: index("guest_support_audit_ticket_created_idx").on(table.ticketId, table.createdAt),
}));

export const guestSupportRateLimits = mysqlTable("guest_support_rate_limits", {
  rateKey: varchar("rateKey", { length: 64 }).primaryKey(),
  windowStartedAt: timestamp("windowStartedAt").notNull(),
  attempts: int("attempts").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  updatedIdx: index("guest_support_rate_updated_idx").on(table.updatedAt),
}));
