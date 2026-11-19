CREATE TABLE `phone_change_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`newPhoneNumber` varchar(20) NOT NULL,
	`newPhoneNormalized` varchar(20) NOT NULL,
	`idFrontCiphertext` longtext NOT NULL,
	`idFrontMimeType` varchar(24) NOT NULL,
	`idBackCiphertext` longtext NOT NULL,
	`idBackMimeType` varchar(24) NOT NULL,
	`selfieCiphertext` longtext NOT NULL,
	`selfieMimeType` varchar(24) NOT NULL,
	`walletProfileCiphertext` longtext NOT NULL,
	`walletProfileMimeType` varchar(24) NOT NULL,
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`rejectionReason` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `phone_change_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `phone_change_phone_unique` UNIQUE(`newPhoneNormalized`,`status`)
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `createdBy` int;--> statement-breakpoint
CREATE INDEX `phone_change_user_created_idx` ON `phone_change_requests` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `phone_change_status_created_idx` ON `phone_change_requests` (`status`,`createdAt`);