CREATE TABLE `gold_funding_wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`name` varchar(100) NOT NULL DEFAULT 'محفظة تمويل الذهب',
	`cashBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gold_funding_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `gold_funding_wallets_adminId_unique` UNIQUE(`adminId`)
);
--> statement-breakpoint
CREATE TABLE `gold_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`walletId` int NOT NULL,
	`karat` enum('24','21','18') NOT NULL,
	`availableGrams` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`reservedGrams` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gold_inventory_id` PRIMARY KEY(`id`),
	CONSTRAINT `gold_inventory_wallet_karat_unique` UNIQUE(`walletId`,`karat`)
);
--> statement-breakpoint
CREATE TABLE `gold_inventory_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`walletId` int NOT NULL,
	`adminId` int NOT NULL,
	`karat` enum('24','21','18') NOT NULL,
	`direction` enum('credit','debit') NOT NULL,
	`grams` decimal(18,6) NOT NULL,
	`cashAmount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`source` varchar(180) NOT NULL,
	`reference` varchar(120) NOT NULL,
	`idempotencyKey` varchar(120) NOT NULL,
	`balanceAfterGrams` decimal(18,6) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gold_inventory_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `gold_inventory_ledger_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `gold_inventory_ledger_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `gold_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(120) NOT NULL,
	`idempotencyKey` varchar(120) NOT NULL,
	`userId` int NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`karat` enum('24','21','18') NOT NULL,
	`grams` decimal(18,6) NOT NULL,
	`unitPrice` decimal(14,4) NOT NULL,
	`grossAmount` decimal(14,2) NOT NULL,
	`feeAmount` decimal(14,2) NOT NULL,
	`status` enum('pending_review','awaiting_execution','executed','delivered','rejected','cancelled') NOT NULL DEFAULT 'pending_review',
	`executionProvider` varchar(120),
	`rejectionReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reviewedAt` timestamp,
	`reviewedBy` int,
	CONSTRAINT `gold_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `gold_orders_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `gold_orders_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `gold_positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`karat` enum('24','21','18') NOT NULL,
	`grams` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`averageCostPerGram` decimal(14,4) NOT NULL DEFAULT '0.0000',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gold_positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `gold_positions_user_karat_unique` UNIQUE(`userId`,`karat`)
);
--> statement-breakpoint
CREATE TABLE `gold_price_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` varchar(120) NOT NULL,
	`sourceSymbol` varchar(32) NOT NULL,
	`ouncePrice` decimal(14,4) NOT NULL,
	`gram24` decimal(14,4) NOT NULL,
	`gram21` decimal(14,4) NOT NULL,
	`gram18` decimal(14,4) NOT NULL,
	`bid` decimal(14,4),
	`ask` decimal(14,4),
	`quotedAt` timestamp NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`isIndicative` int NOT NULL DEFAULT 1,
	`rawPayload` longtext,
	CONSTRAINT `gold_price_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gold_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enabled` int NOT NULL DEFAULT 0,
	`buyFee` decimal(14,2) NOT NULL DEFAULT '1.00',
	`sellFee` decimal(14,2) NOT NULL DEFAULT '1.00',
	`buySpreadPerGram` decimal(14,4) NOT NULL DEFAULT '0.00',
	`sellSpreadPerGram` decimal(14,4) NOT NULL DEFAULT '0.00',
	`makingChargePerGram` decimal(14,4) NOT NULL DEFAULT '0.00',
	`minGrams` decimal(18,6) NOT NULL DEFAULT '0.001000',
	`maxGrams` decimal(18,6) NOT NULL DEFAULT '1000.000000',
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gold_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `gold_inventory_ledger_wallet_karat_idx` ON `gold_inventory_ledger` (`walletId`,`karat`,`createdAt`);--> statement-breakpoint
CREATE INDEX `gold_orders_user_created_idx` ON `gold_orders` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `gold_orders_status_created_idx` ON `gold_orders` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `gold_price_snapshots_source_quoted_idx` ON `gold_price_snapshots` (`source`,`quotedAt`);