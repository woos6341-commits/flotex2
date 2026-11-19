CREATE TABLE `guest_support_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`senderRole` enum('guest','admin') NOT NULL,
	`adminId` int,
	`body` text NOT NULL,
	`attachmentCiphertext` longtext,
	`attachmentMimeType` varchar(24),
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guest_support_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guest_support_sessions` (
	`id` varchar(36) NOT NULL,
	`ticketId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guest_support_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `guest_support_sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `guest_support_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketCode` varchar(24) NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`contactEmail` varchar(320),
	`contactPhone` varchar(24),
	`otpChallengeId` varchar(36),
	`verifiedAt` timestamp,
	`status` enum('new','pending_reply','replied','closed') NOT NULL DEFAULT 'new',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`closedAt` timestamp,
	CONSTRAINT `guest_support_tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `guest_support_tickets_ticketCode_unique` UNIQUE(`ticketCode`)
);
--> statement-breakpoint
ALTER TABLE `auth_email_challenges` MODIFY COLUMN `purpose` enum('register','password_reset','account_support','guest_support') NOT NULL;--> statement-breakpoint
CREATE INDEX `guest_support_messages_ticket_created_idx` ON `guest_support_messages` (`ticketId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `guest_support_messages_ticket_read_idx` ON `guest_support_messages` (`ticketId`,`readAt`);--> statement-breakpoint
CREATE INDEX `guest_support_sessions_ticket_expiry_idx` ON `guest_support_sessions` (`ticketId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `guest_support_tickets_status_updated_idx` ON `guest_support_tickets` (`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `guest_support_tickets_email_created_idx` ON `guest_support_tickets` (`contactEmail`,`createdAt`);