ALTER TABLE `push_deliveries` DROP INDEX `push_deliveries_operation_token_unique`;--> statement-breakpoint
ALTER TABLE `transactions` MODIFY COLUMN `type` enum('deposit','withdrawal','profit','loss','adjustment','transfer','fee') NOT NULL;--> statement-breakpoint
ALTER TABLE `money_transfers` ADD `feeAmount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `push_deliveries` ADD `attemptCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `push_deliveries` ADD `lastAttemptAt` timestamp;--> statement-breakpoint
ALTER TABLE `requests` ADD `feeAmount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `rejectionReason` text;--> statement-breakpoint
ALTER TABLE `push_deliveries` ADD CONSTRAINT `push_deliveries_operation_token_unique` UNIQUE(`operationId`,`token`,`userId`);