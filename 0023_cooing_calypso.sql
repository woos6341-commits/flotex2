CREATE TABLE `savings_payouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`planId` int NOT NULL,
	`userId` int NOT NULL,
	`periodKey` varchar(40) NOT NULL,
	`periodStart` timestamp NOT NULL,
	`periodEnd` timestamp NOT NULL,
	`expectedAmount` decimal(14,4) NOT NULL,
	`paidAmount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`status` enum('blocked','paid') NOT NULL DEFAULT 'blocked',
	`blockReason` text,
	`transactionReference` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`paidAt` timestamp,
	CONSTRAINT `savings_payouts_id` PRIMARY KEY(`id`),
	CONSTRAINT `savings_payouts_plan_period_unique` UNIQUE(`planId`,`periodKey`)
);
--> statement-breakpoint
CREATE TABLE `savings_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(80) NOT NULL,
	`clientOperationId` varchar(80) NOT NULL,
	`userId` int NOT NULL,
	`principalAmount` decimal(14,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EGP',
	`frequency` enum('daily','monthly','yearly') NOT NULL,
	`ratePercent` decimal(8,4) NOT NULL,
	`status` enum('pending_approval','active','rejected','completed','cancelled') NOT NULL DEFAULT 'pending_approval',
	`startAt` timestamp,
	`nextPayoutAt` timestamp,
	`approvedBy` int,
	`approvedAt` timestamp,
	`rejectionReason` text,
	`lastPayoutAt` timestamp,
	`totalAccrued` decimal(14,4) NOT NULL DEFAULT '0.0000',
	`totalPaid` decimal(14,2) NOT NULL DEFAULT '0.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `savings_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `savings_plans_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `savings_plans_clientOperationId_unique` UNIQUE(`clientOperationId`)
);
--> statement-breakpoint
ALTER TABLE `wallets` ADD `reservedSavings` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
CREATE INDEX `savings_payouts_user_idx` ON `savings_payouts` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `savings_plans_user_idx` ON `savings_plans` (`userId`);--> statement-breakpoint
CREATE INDEX `savings_plans_status_idx` ON `savings_plans` (`status`);--> statement-breakpoint
CREATE INDEX `savings_plans_next_payout_idx` ON `savings_plans` (`status`,`nextPayoutAt`);