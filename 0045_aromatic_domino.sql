CREATE TABLE `external_transfer_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(40) NOT NULL,
	`clientOperationId` varchar(100) NOT NULL,
	`userId` int NOT NULL,
	`countryCode` varchar(4) NOT NULL,
	`countryName` varchar(80) NOT NULL,
	`currencyName` varchar(80) NOT NULL,
	`currencyCode` varchar(8) NOT NULL,
	`status` enum('new','under_review','awaiting_details','approved','completed','rejected') NOT NULL DEFAULT 'new',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`rejectionReason` text,
	CONSTRAINT `external_transfer_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `external_transfer_requests_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `external_transfer_requests_clientOperationId_unique` UNIQUE(`clientOperationId`)
);
--> statement-breakpoint
CREATE INDEX `external_transfer_requests_user_created_idx` ON `external_transfer_requests` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `external_transfer_requests_status_created_idx` ON `external_transfer_requests` (`status`,`createdAt`);