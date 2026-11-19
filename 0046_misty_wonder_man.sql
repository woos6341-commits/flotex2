ALTER TABLE `support_messages` ADD `category` enum('account','freeze','external_transaction') DEFAULT 'account' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `nationalIdFingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `lastOpenedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `appVersion` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `appBuildNumber` varchar(48);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_national_id_fingerprint_unique` UNIQUE(`nationalIdFingerprint`);--> statement-breakpoint
CREATE INDEX `support_messages_user_category_created_idx` ON `support_messages` (`userId`,`category`,`createdAt`);--> statement-breakpoint
CREATE INDEX `support_messages_category_created_idx` ON `support_messages` (`category`,`createdAt`);