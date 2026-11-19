CREATE TABLE `savings_setting_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`field` varchar(40) NOT NULL,
	`oldValue` varchar(40) NOT NULL,
	`newValue` varchar(40) NOT NULL,
	`changedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `savings_setting_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `savings_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feeAmount` decimal(14,2) NOT NULL DEFAULT '1.00',
	`dailyRatePercent` decimal(8,4) NOT NULL DEFAULT '0.0548',
	`monthlyRatePercent` decimal(8,4) NOT NULL DEFAULT '1.6667',
	`yearlyRatePercent` decimal(8,4) NOT NULL DEFAULT '20.0000',
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `savings_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `savings_plans` ADD `ratePpm` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `savings_plans` ADD `feeAmount` decimal(14,2) DEFAULT '1.00' NOT NULL;--> statement-breakpoint
CREATE INDEX `savings_setting_audits_field_changed_idx` ON `savings_setting_audits` (`field`,`changedAt`);--> statement-breakpoint
CREATE INDEX `savings_setting_audits_admin_changed_idx` ON `savings_setting_audits` (`adminId`,`changedAt`);