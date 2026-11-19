CREATE TABLE `phone_verification_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`phoneNumber` varchar(20) NOT NULL,
	`phoneNormalized` varchar(20) NOT NULL,
	`message` text,
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `phone_verification_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_profile_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`targetUserId` int NOT NULL,
	`changes` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_profile_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `phoneVerifiedAt` timestamp;--> statement-breakpoint
UPDATE `users` AS `u`
INNER JOIN `auth_password_credentials` AS `c` ON `c`.`userId` = `u`.`id`
SET `u`.`phoneVerifiedAt` = `c`.`phoneVerifiedAt`
WHERE `u`.`phoneVerifiedAt` IS NULL AND `c`.`phoneVerifiedAt` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `phone_verification_user_created_idx` ON `phone_verification_requests` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `phone_verification_status_created_idx` ON `phone_verification_requests` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `phone_verification_phone_idx` ON `phone_verification_requests` (`phoneNormalized`);--> statement-breakpoint
CREATE INDEX `user_profile_audit_target_created_idx` ON `user_profile_audits` (`targetUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `user_profile_audit_admin_created_idx` ON `user_profile_audits` (`adminId`,`createdAt`);
