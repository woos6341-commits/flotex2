CREATE TABLE `push_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`operationId` varchar(120) NOT NULL,
	`token` varchar(512) NOT NULL,
	`provider` varchar(32) NOT NULL,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`providerMessageId` varchar(180),
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	CONSTRAINT `push_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_deliveries_operation_token_unique` UNIQUE(`operationId`,`token`)
);
--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`token` varchar(512) NOT NULL,
	`provider` varchar(32) NOT NULL DEFAULT 'expo',
	`platform` varchar(24) NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `push_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `operationId` varchar(120);--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_operation_unique` UNIQUE(`userId`,`operationId`);--> statement-breakpoint
CREATE INDEX `push_deliveries_user_idx` ON `push_deliveries` (`userId`);--> statement-breakpoint
CREATE INDEX `push_tokens_user_idx` ON `push_tokens` (`userId`);