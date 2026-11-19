CREATE TABLE `support_thread_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`category` enum('account','freeze','external_transaction') NOT NULL,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`closedBy` int,
	`closedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `support_thread_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `support_thread_states_user_category_unique` UNIQUE(`userId`,`category`)
);
--> statement-breakpoint
ALTER TABLE `external_transfer_requests` ADD `foreignAmount` decimal(14,2);--> statement-breakpoint
ALTER TABLE `external_transfer_requests` ADD `exchangeRate` decimal(14,6);--> statement-breakpoint
ALTER TABLE `external_transfer_requests` ADD `egpEquivalent` decimal(14,2);--> statement-breakpoint
ALTER TABLE `external_transfer_requests` ADD `feeEgp` decimal(14,2);--> statement-breakpoint
ALTER TABLE `external_transfer_requests` ADD `pricingUpdatedAt` timestamp;--> statement-breakpoint
CREATE INDEX `support_thread_states_status_updated_idx` ON `support_thread_states` (`status`,`updatedAt`);