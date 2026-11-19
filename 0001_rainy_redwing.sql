CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operationId` varchar(100) NOT NULL,
	`adminId` int NOT NULL,
	`targetUserId` int NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`reason` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_operation_unique` UNIQUE(`operationId`)
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(80) NOT NULL,
	`userId` int NOT NULL,
	`type` enum('deposit','withdrawal') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`note` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `requests_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(80) NOT NULL,
	`userId` int NOT NULL,
	`type` enum('deposit','withdrawal','profit','loss','adjustment') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'approved',
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `transactions_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`profitLoss` decimal(14,2) NOT NULL DEFAULT '0.00',
	`currency` varchar(8) NOT NULL DEFAULT 'USD',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `wallets_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `requests_status_idx` ON `requests` (`status`);--> statement-breakpoint
CREATE INDEX `requests_user_idx` ON `requests` (`userId`);--> statement-breakpoint
CREATE INDEX `transactions_user_idx` ON `transactions` (`userId`);