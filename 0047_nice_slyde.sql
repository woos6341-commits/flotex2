CREATE TABLE `game_topup_funding_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int,
	`direction` enum('credit','debit') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`balanceBefore` decimal(14,2) NOT NULL,
	`balanceAfter` decimal(14,2) NOT NULL,
	`note` varchar(255),
	`operationId` varchar(80) NOT NULL,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `game_topup_funding_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `game_topup_funding_entries_operationId_unique` UNIQUE(`operationId`)
);
--> statement-breakpoint
CREATE TABLE `game_topup_games` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`currencyLabel` varchar(24) NOT NULL DEFAULT 'جوهرة',
	`imageUrl` text,
	`minQuantity` int NOT NULL DEFAULT 1,
	`unitPrice` decimal(12,4) NOT NULL DEFAULT '0.0000',
	`fieldsJson` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `game_topup_games_id` PRIMARY KEY(`id`),
	CONSTRAINT `game_topup_games_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `game_topup_packages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`label` varchar(80),
	`quantity` int NOT NULL,
	`price` decimal(14,2) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `game_topup_packages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_topup_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(80) NOT NULL,
	`userId` int NOT NULL,
	`gameId` int NOT NULL,
	`gameName` varchar(80) NOT NULL,
	`packageId` int,
	`packageLabel` varchar(80),
	`quantity` int NOT NULL,
	`unitPrice` decimal(12,4) NOT NULL,
	`totalAmount` decimal(14,2) NOT NULL,
	`playerDataJson` text NOT NULL,
	`status` enum('new','under_review','approved','processing','completed','rejected','cancelled') NOT NULL DEFAULT 'new',
	`adminNote` text,
	`rejectionReason` text,
	`providerReference` varchar(150),
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`completedAt` timestamp,
	`idempotencyKey` varchar(80) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `game_topup_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `game_topup_requests_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `game_topup_requests_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `game_topup_settings` (
	`id` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`fundingBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `game_topup_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `game_topup_funding_request_idx` ON `game_topup_funding_entries` (`requestId`);--> statement-breakpoint
CREATE INDEX `game_topup_packages_game_idx` ON `game_topup_packages` (`gameId`);--> statement-breakpoint
CREATE INDEX `game_topup_requests_status_idx` ON `game_topup_requests` (`status`);--> statement-breakpoint
CREATE INDEX `game_topup_requests_user_idx` ON `game_topup_requests` (`userId`);--> statement-breakpoint
CREATE INDEX `game_topup_requests_created_idx` ON `game_topup_requests` (`createdAt`);