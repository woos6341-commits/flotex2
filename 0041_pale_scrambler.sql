ALTER TABLE `phone_change_requests` DROP INDEX `phone_change_phone_unique`;--> statement-breakpoint
ALTER TABLE `phone_change_requests` ADD `pendingPhoneNormalized` varchar(20);--> statement-breakpoint
ALTER TABLE `phone_change_requests` ADD CONSTRAINT `phone_change_pending_phone_unique` UNIQUE(`pendingPhoneNormalized`);