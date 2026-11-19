ALTER TABLE `audit_logs` ADD `balanceBefore` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `balanceAfter` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `customerId` varchar(10) NULL;--> statement-breakpoint
UPDATE `users` SET `customerId` = LPAD(CAST(`id` AS CHAR), 10, '0') WHERE `customerId` IS NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY `customerId` varchar(10) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_customerId_unique` UNIQUE(`customerId`);