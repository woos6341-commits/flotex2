CREATE TABLE `savings_financing_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`walletId` int NOT NULL,
	`adminId` int NOT NULL,
	`adminName` varchar(160) NOT NULL,
	`savingsPlanId` int,
	`customerUserId` int,
	`customerName` varchar(160),
	`reference` varchar(120) NOT NULL,
	`idempotencyKey` varchar(100) NOT NULL,
	`type` enum('manual_funding','savings_principal','savings_profit','savings_refund') NOT NULL,
	`direction` enum('credit','debit') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`source` varchar(200) NOT NULL,
	`balanceBefore` decimal(14,2) NOT NULL,
	`balanceAfter` decimal(14,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `savings_financing_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `savings_financing_entries_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `savings_financing_entries_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `savings_financing_wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`name` varchar(80) NOT NULL DEFAULT 'محفظة تمويل الإدخار',
	`balance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`currency` varchar(8) NOT NULL DEFAULT 'EGP',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `savings_financing_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `savings_financing_wallets_adminId_unique` UNIQUE(`adminId`)
);
--> statement-breakpoint
ALTER TABLE `savings_plans` MODIFY COLUMN `status` enum('pending_approval','active','rejected','completed','refunded','cancelled') NOT NULL DEFAULT 'pending_approval';--> statement-breakpoint
ALTER TABLE `savings_plans` ADD `financingWalletId` int;--> statement-breakpoint
CREATE INDEX `savings_financing_entries_wallet_created_idx` ON `savings_financing_entries` (`walletId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `savings_financing_entries_plan_idx` ON `savings_financing_entries` (`savingsPlanId`);--> statement-breakpoint
CREATE INDEX `savings_financing_entries_type_created_idx` ON `savings_financing_entries` (`type`,`createdAt`);--> statement-breakpoint
CREATE INDEX `savings_plans_financing_wallet_idx` ON `savings_plans` (`financingWalletId`);