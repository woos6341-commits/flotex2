CREATE TABLE `admin_immediate_accounts` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`createdById` int NOT NULL,
	`createdByName` varchar(160) NOT NULL,
	`createdAt` timestamp(3) NOT NULL,
	`firstLoginAt` timestamp(3),
	`passwordChangedAt` timestamp(3),
	`challengeHash` varchar(64),
	`challengeExpiresAt` timestamp(3),
	CONSTRAINT `admin_immediate_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_immediate_accounts_user_uq` UNIQUE(`userId`),
	CONSTRAINT `admin_immediate_accounts_challenge_uq` UNIQUE(`challengeHash`)
);
--> statement-breakpoint
ALTER TABLE `auth_password_credentials` MODIFY COLUMN `emailVerifiedAt` timestamp;--> statement-breakpoint
CREATE INDEX `admin_immediate_accounts_created_idx` ON `admin_immediate_accounts` (`createdAt`);