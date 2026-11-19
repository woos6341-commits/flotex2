CREATE TABLE `cash_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entryReference` varchar(120) NOT NULL,
	`idempotencyKey` varchar(120) NOT NULL,
	`userId` int NOT NULL,
	`direction` enum('credit','debit') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`balanceAfter` decimal(14,2) NOT NULL,
	`source` varchar(80) NOT NULL,
	`status` enum('pending','confirmed','reversed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cash_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `cash_ledger_entryReference_unique` UNIQUE(`entryReference`),
	CONSTRAINT `cash_ledger_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`executionId` varchar(150) NOT NULL,
	`orderId` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`price` decimal(14,4) NOT NULL,
	`fees` decimal(14,4) NOT NULL DEFAULT '0',
	`executedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `executions_id` PRIMARY KEY(`id`),
	CONSTRAINT `executions_executionId_unique` UNIQUE(`executionId`)
);
--> statement-breakpoint
CREATE TABLE `market_instruments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`nameArabic` varchar(255) NOT NULL,
	`exchange` varchar(32) NOT NULL DEFAULT 'EGX',
	`dataSource` varchar(120) NOT NULL,
	`dataLicense` varchar(255),
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `market_instruments_id` PRIMARY KEY(`id`),
	CONSTRAINT `market_instruments_symbol_unique` UNIQUE(`symbol`)
);
--> statement-breakpoint
CREATE TABLE `market_quotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`lastPrice` decimal(14,4) NOT NULL,
	`change` decimal(14,4) NOT NULL DEFAULT '0',
	`changePercent` decimal(8,4) NOT NULL DEFAULT '0',
	`source` varchar(120) NOT NULL,
	`isIndicative` int NOT NULL DEFAULT 0,
	`quotedAt` timestamp NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `market_quotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`type` varchar(40) NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientOrderId` varchar(100) NOT NULL,
	`idempotencyKey` varchar(120) NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`orderType` enum('market','limit') NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`limitPrice` decimal(14,4),
	`status` enum('draft','submitted','partially_filled','filled','rejected','cancelled') NOT NULL DEFAULT 'draft',
	`broker` varchar(120),
	`brokerOrderId` varchar(150),
	`rejectionReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`submittedAt` timestamp,
	`filledAt` timestamp,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_clientOrderId_unique` UNIQUE(`clientOrderId`),
	CONSTRAINT `orders_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `payment_transfers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int,
	`provider` varchar(80) NOT NULL,
	`providerReference` varchar(150) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`direction` enum('inbound','outbound') NOT NULL,
	`status` enum('received','verified','failed','reversed') NOT NULL DEFAULT 'received',
	`verifiedBy` int,
	`verifiedAt` timestamp,
	`rawPayload` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_transfers_providerReference_unique` UNIQUE(`providerReference`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`quantity` decimal(18,6) NOT NULL DEFAULT '0',
	`averagePrice` decimal(14,4) NOT NULL DEFAULT '0',
	`marketValue` decimal(14,4) NOT NULL DEFAULT '0',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `positions_user_symbol_unique` UNIQUE(`userId`,`symbol`)
);
--> statement-breakpoint
ALTER TABLE `requests` ADD `paymentChannel` varchar(40);--> statement-breakpoint
ALTER TABLE `requests` ADD `transferReference` varchar(150);--> statement-breakpoint
CREATE INDEX `cash_ledger_user_idx` ON `cash_ledger` (`userId`);--> statement-breakpoint
CREATE INDEX `market_quotes_symbol_time_idx` ON `market_quotes` (`symbol`,`quotedAt`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`userId`);--> statement-breakpoint
CREATE INDEX `orders_broker_idx` ON `orders` (`brokerOrderId`);