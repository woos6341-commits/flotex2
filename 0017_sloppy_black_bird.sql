CREATE TABLE `auth_email_challenges` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`purpose` enum('register','password_reset') NOT NULL,
	`userId` int,
	`phoneNormalized` varchar(20),
	`codeHash` varchar(64) NOT NULL,
	`attemptCount` int NOT NULL DEFAULT 0,
	`codeExpiresAt` timestamp NOT NULL,
	`codeConsumedAt` timestamp,
	`grantHash` varchar(64),
	`grantExpiresAt` timestamp,
	`grantConsumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_email_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_password_credentials` (
	`userId` int NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`emailVerifiedAt` timestamp NOT NULL,
	`phoneVerifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `auth_password_credentials_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `emailNormalized` varchar(320);--> statement-breakpoint
ALTER TABLE `users` ADD `phoneNormalized` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_normalized_unique` UNIQUE(`emailNormalized`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_phone_normalized_unique` UNIQUE(`phoneNormalized`);--> statement-breakpoint
CREATE INDEX `auth_email_challenges_email_purpose_idx` ON `auth_email_challenges` (`email`,`purpose`,`createdAt`);--> statement-breakpoint
CREATE INDEX `auth_email_challenges_expiry_idx` ON `auth_email_challenges` (`codeExpiresAt`);--> statement-breakpoint
CREATE INDEX `auth_email_challenges_user_idx` ON `auth_email_challenges` (`userId`);