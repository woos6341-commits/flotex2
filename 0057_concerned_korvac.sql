CREATE TABLE `user_email_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(80) NOT NULL,
	`adminId` int NOT NULL,
	`userId` int NOT NULL,
	`toEmail` varchar(320) NOT NULL,
	`subject` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	CONSTRAINT `user_email_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_deliveries_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE INDEX `user_email_deliveries_user_created_idx` ON `user_email_deliveries` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `user_email_deliveries_admin_created_idx` ON `user_email_deliveries` (`adminId`,`createdAt`);