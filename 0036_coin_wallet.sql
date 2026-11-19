CREATE TABLE `coin_ledger_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(120) NOT NULL,
	`idempotencyKey` varchar(120) NOT NULL,
	`adminId` int,
	`userId` int,
	`kind` enum('inventory','buy_cash','sell_funding') NOT NULL,
	`direction` enum('credit','debit') NOT NULL,
	`quantity` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`amount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`source` varchar(200) NOT NULL,
	`balanceAfterQuantity` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`balanceAfterAmount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coin_ledger_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `coin_ledger_entries_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `coin_ledger_entries_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `coin_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(120) NOT NULL,
	`idempotencyKey` varchar(120) NOT NULL,
	`userId` int NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`unitPrice` decimal(14,2) NOT NULL,
	`grossAmount` decimal(14,2) NOT NULL,
	`feeAmount` decimal(14,2) NOT NULL,
	`totalAmount` decimal(14,2) NOT NULL,
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`rejectionReason` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coin_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `coin_orders_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `coin_orders_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `coin_price_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`previousBuyPrice` decimal(14,2) NOT NULL,
	`newBuyPrice` decimal(14,2) NOT NULL,
	`previousSellPrice` decimal(14,2) NOT NULL,
	`newSellPrice` decimal(14,2) NOT NULL,
	`reason` varchar(240) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coin_price_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coin_settings` (
	`id` int NOT NULL,
	`buyPrice` decimal(14,2) NOT NULL DEFAULT '50.00',
	`sellPrice` decimal(14,2) NOT NULL DEFAULT '50.00',
	`buyFee` decimal(14,2) NOT NULL DEFAULT '1.00',
	`sellFee` decimal(14,2) NOT NULL DEFAULT '1.00',
	`buyFeeEnabled` int NOT NULL DEFAULT 1,
	`sellFeeEnabled` int NOT NULL DEFAULT 1,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coin_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coin_treasuries` (
	`id` int NOT NULL,
	`totalCoins` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`availableCoins` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`reservedCoins` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`buyCashBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`sellFundingBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`reservedSellCash` decimal(14,2) NOT NULL DEFAULT '0.00',
	`totalBuyCollected` decimal(14,2) NOT NULL DEFAULT '0.00',
	`totalSellPaid` decimal(14,2) NOT NULL DEFAULT '0.00',
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coin_treasuries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coin_wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`reserved` decimal(18,6) NOT NULL DEFAULT '0.000000',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coin_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `coin_wallets_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `coin_ledger_kind_created_idx` ON `coin_ledger_entries` (`kind`,`createdAt`);--> statement-breakpoint
CREATE INDEX `coin_ledger_user_created_idx` ON `coin_ledger_entries` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `coin_orders_user_created_idx` ON `coin_orders` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `coin_orders_status_created_idx` ON `coin_orders` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `coin_price_audits_created_idx` ON `coin_price_audits` (`createdAt`);