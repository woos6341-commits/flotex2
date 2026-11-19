CREATE TABLE `account_verification_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('manual_verified','revoked') NOT NULL,
	`adminId` int NOT NULL,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_verification_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_verification_overrides_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `account_verification_overrides_status_updated_idx` ON `account_verification_overrides` (`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `account_verification_overrides_admin_updated_idx` ON `account_verification_overrides` (`adminId`,`updatedAt`);