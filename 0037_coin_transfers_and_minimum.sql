CREATE TABLE `coin_transfers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(120) NOT NULL,
	`idempotencyKey` varchar(120) NOT NULL,
	`senderUserId` int NOT NULL,
	`recipientUserId` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`rejectionReason` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coin_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `coin_transfers_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `coin_transfers_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `coin_ledger_entries` MODIFY COLUMN `kind` enum('inventory','buy_cash','sell_funding','transfer') NOT NULL;--> statement-breakpoint
ALTER TABLE `coin_settings` ADD `transferMinimum` decimal(14,6) DEFAULT '2.000000' NOT NULL;--> statement-breakpoint
CREATE INDEX `coin_transfers_sender_created_idx` ON `coin_transfers` (`senderUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `coin_transfers_recipient_created_idx` ON `coin_transfers` (`recipientUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `coin_transfers_status_created_idx` ON `coin_transfers` (`status`,`createdAt`);