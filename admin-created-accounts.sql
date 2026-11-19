-- Independent, REVIEW-ONLY migration. Apply through the project's controlled migration process;
-- do not execute against a shared/production database without backup and approval.
CREATE TABLE `admin_created_accounts` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
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
  `identityReviewedAt` timestamp(3) NULL,
  `invitationHash` varchar(64),
  `invitationExpiresAt` timestamp(3) NULL,
  `invitationConsumedAt` timestamp(3) NULL,
  `emailVerifiedAt` timestamp(3) NULL,
  `userId` int,
  `customerId` varchar(10),
  UNIQUE KEY `admin_created_accounts_email_uq` (`email`),
  UNIQUE KEY `admin_created_accounts_invitation_uq` (`invitationHash`),
  UNIQUE KEY `admin_created_accounts_user_uq` (`userId`),
  KEY `admin_created_accounts_created_idx` (`createdAt`)
) ENGINE=InnoDB;
CREATE TABLE `admin_created_account_events` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `requestId` varchar(36) NOT NULL,
  `actorId` int,
  `actorName` varchar(160) NOT NULL,
  `event` varchar(40) NOT NULL,
  `details` text,
  `createdAt` timestamp(3) NOT NULL,
  KEY `admin_created_account_events_request_idx` (`requestId`, `id`)
) ENGINE=InnoDB;
