CREATE TABLE `payment_methods` (
	`id` varchar(20) NOT NULL,
	`name` varchar(40) NOT NULL,
	`transferNumber` varchar(120),
	`imageUrl` text,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_methods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `requests` MODIFY COLUMN `status` enum('pending','approved','rejected','completed') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `requests` ADD `receiptImageUrl` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `paymentMethodId` varchar(20);--> statement-breakpoint
ALTER TABLE `requests` ADD `clientOperationId` varchar(80);--> statement-breakpoint
ALTER TABLE `requests` ADD `payloadHash` varchar(64);--> statement-breakpoint
ALTER TABLE `requests` ADD `senderReference` varchar(150);--> statement-breakpoint
ALTER TABLE `requests` ADD `transferNumberSnapshot` varchar(120);--> statement-breakpoint
ALTER TABLE `requests` ADD `payoutReference` varchar(150);--> statement-breakpoint
ALTER TABLE `requests` ADD CONSTRAINT `requests_clientOperationId_unique` UNIQUE(`clientOperationId`);--> statement-breakpoint
ALTER TABLE `requests` ADD CONSTRAINT `requests_payoutReference_unique` UNIQUE(`payoutReference`);