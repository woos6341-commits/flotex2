CREATE TABLE `money_transfers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(80) NOT NULL,
	`senderUserId` int NOT NULL,
	`recipientUserId` int NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EGP',
	`note` text,
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`rejectionReason` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`cancelledAt` timestamp,
	`idempotencyKey` varchar(80) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `money_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `money_transfers_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `money_transfers_idempotency_unique` UNIQUE(`senderUserId`,`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `transactions` MODIFY COLUMN `type` enum('deposit','withdrawal','profit','loss','adjustment','transfer') NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` MODIFY COLUMN `status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'approved';--> statement-breakpoint
ALTER TABLE `wallets` ADD `reservedTransfers` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
CREATE INDEX `money_transfers_sender_created_idx` ON `money_transfers` (`senderUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `money_transfers_recipient_created_idx` ON `money_transfers` (`recipientUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `money_transfers_status_created_idx` ON `money_transfers` (`status`,`createdAt`);