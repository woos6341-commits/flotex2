CREATE TABLE `guest_support_audit_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`adminId` int NOT NULL,
	`action` enum('reply','status_change') NOT NULL,
	`previousStatus` varchar(24) NOT NULL,
	`newStatus` varchar(24) NOT NULL,
	`messageId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guest_support_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guest_support_message_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`senderRole` enum('guest','admin') NOT NULL,
	`operationId` varchar(100) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`messageId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guest_support_message_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `guest_support_message_operation_unique` UNIQUE(`ticketId`,`senderRole`,`operationId`)
);
--> statement-breakpoint
CREATE TABLE `guest_support_rate_limits` (
	`rateKey` varchar(64) NOT NULL,
	`windowStartedAt` timestamp NOT NULL,
	`attempts` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `guest_support_rate_limits_rateKey` PRIMARY KEY(`rateKey`)
);
--> statement-breakpoint
CREATE TABLE `manual_verification_codes` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`purpose` enum('register','password_reset') NOT NULL,
	`userId` int,
	`phoneNormalized` varchar(20),
	`codeHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`maxAttempts` int NOT NULL,
	`attemptCount` int NOT NULL DEFAULT 0,
	`issuedBy` int NOT NULL,
	`issuedByName` varchar(255) NOT NULL,
	`ownershipMethod` varchar(40) NOT NULL,
	`ownershipCaseRef` varchar(80) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`usedAt` timestamp,
	`lockedAt` timestamp,
	`revokedAt` timestamp,
	`revokedBy` int,
	`revokedByName` varchar(255),
	`revokeReason` varchar(24),
	CONSTRAINT `manual_verification_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_created_account_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` varchar(36) NOT NULL,
	`actorId` int,
	`actorName` varchar(160) NOT NULL,
	`event` varchar(40) NOT NULL,
	`details` text,
	`createdAt` timestamp(3) NOT NULL,
	CONSTRAINT `admin_created_account_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_created_accounts` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(120) NOT NULL,
	`phoneNumber` varchar(20),
	`state` enum('draft','verification_required','active','suspended') NOT NULL,
	`suspendedFrom` enum('draft','verification_required'),
	`createdById` int NOT NULL,
	`createdByName` varchar(160) NOT NULL,
	`createdAt` timestamp(3) NOT NULL,
	`identityEvidenceRef` varchar(120),
	`identityReviewedById` int,
	`identityReviewedByName` varchar(160),
	`identityReviewedAt` timestamp(3),
	`invitationHash` varchar(64),
	`invitationExpiresAt` timestamp(3),
	`invitationConsumedAt` timestamp(3),
	`emailVerifiedAt` timestamp(3),
	`userId` int,
	`customerId` varchar(10),
	CONSTRAINT `admin_created_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_created_accounts_email_uq` UNIQUE(`email`),
	CONSTRAINT `admin_created_accounts_invitation_uq` UNIQUE(`invitationHash`),
	CONSTRAINT `admin_created_accounts_user_uq` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `guest_support_audit_ticket_created_idx` ON `guest_support_audit_events` (`ticketId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `guest_support_rate_updated_idx` ON `guest_support_rate_limits` (`updatedAt`);--> statement-breakpoint
CREATE INDEX `manual_verification_scope_idx` ON `manual_verification_codes` (`email`,`purpose`,`createdAt`);--> statement-breakpoint
CREATE INDEX `manual_verification_created_idx` ON `manual_verification_codes` (`createdAt`);--> statement-breakpoint
CREATE INDEX `admin_created_account_events_request_idx` ON `admin_created_account_events` (`requestId`,`id`);--> statement-breakpoint
CREATE INDEX `admin_created_accounts_created_idx` ON `admin_created_accounts` (`createdAt`);