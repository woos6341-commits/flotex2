CREATE TABLE `auth_challenges` (
	`id` varchar(64) NOT NULL,
	`purpose` enum('google_state','google_handoff') NOT NULL,
	`payload` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`subject` varchar(255) NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_identities_subject` PRIMARY KEY(`subject`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `givenName` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `fatherName` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `phoneNumber` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `profileCompletedAt` timestamp;--> statement-breakpoint
CREATE INDEX `auth_challenges_expiry_idx` ON `auth_challenges` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `auth_identities_user_idx` ON `auth_identities` (`userId`);