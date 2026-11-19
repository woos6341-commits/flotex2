CREATE TABLE `support_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`senderRole` enum('user','admin') NOT NULL,
	`adminId` int,
	`body` text NOT NULL,
	`attachmentCiphertext` longtext,
	`attachmentMimeType` varchar(24),
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `support_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `securityPinHash` varchar(256);--> statement-breakpoint
ALTER TABLE `users` ADD `securityPinUpdatedAt` timestamp;--> statement-breakpoint
CREATE INDEX `support_messages_user_created_idx` ON `support_messages` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `support_messages_user_read_idx` ON `support_messages` (`userId`,`readAt`);