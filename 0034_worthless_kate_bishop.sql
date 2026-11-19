CREATE TABLE `auth_device_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`deviceId` varchar(128) NOT NULL,
	`deviceName` varchar(160),
	`platform` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastActivityAt` timestamp NOT NULL DEFAULT (now()),
	`trustedAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	`revokeReason` varchar(120),
	CONSTRAINT `auth_device_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_device_sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `auth_login_challenges` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`challengeHash` varchar(64) NOT NULL,
	`deviceId` varchar(128) NOT NULL,
	`deviceName` varchar(160),
	`platform` varchar(32),
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_login_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_login_challenges_challengeHash_unique` UNIQUE(`challengeHash`)
);
--> statement-breakpoint
CREATE INDEX `auth_device_sessions_user_activity_idx` ON `auth_device_sessions` (`userId`,`lastActivityAt`);--> statement-breakpoint
CREATE INDEX `auth_device_sessions_user_device_idx` ON `auth_device_sessions` (`userId`,`deviceId`);--> statement-breakpoint
CREATE INDEX `auth_login_challenges_user_expiry_idx` ON `auth_login_challenges` (`userId`,`expiresAt`);