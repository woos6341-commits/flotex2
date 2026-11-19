ALTER TABLE `admin_immediate_accounts` ADD `failedLoginAttempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_immediate_accounts` ADD `loginLockedUntil` timestamp(3);