CREATE TABLE `account_status_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetUserId` int NOT NULL,
	`actorUserId` int NOT NULL,
	`actorType` enum('user','admin') NOT NULL,
	`action` enum('soft_delete','restore') NOT NULL,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `account_status_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_payment_method_access` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`methodId` varchar(20) NOT NULL,
	`depositEnabled` int NOT NULL DEFAULT 1,
	`withdrawalEnabled` int NOT NULL DEFAULT 1,
	`updatedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_payment_method_access_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_payment_method_access_user_method_unique` UNIQUE(`userId`,`methodId`)
);
--> statement-breakpoint
CREATE TABLE `auth_support_sessions` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_support_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_support_sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `auth_email_challenges` MODIFY COLUMN `purpose` enum('register','password_reset','account_support') NOT NULL;--> statement-breakpoint
ALTER TABLE `savings_plans` ADD `nextPayoutAttemptAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `status` enum('active','deleted') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `deletedAt` timestamp;--> statement-breakpoint
CREATE INDEX `account_status_events_target_created_idx` ON `account_status_events` (`targetUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `account_status_events_actor_created_idx` ON `account_status_events` (`actorUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `customer_payment_method_access_user_idx` ON `customer_payment_method_access` (`userId`);--> statement-breakpoint
CREATE INDEX `auth_support_sessions_user_expiry_idx` ON `auth_support_sessions` (`userId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `savings_plans_payout_attempt_idx` ON `savings_plans` (`status`,`nextPayoutAttemptAt`);