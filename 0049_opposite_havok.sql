ALTER TABLE `game_topup_games` ADD `serviceType` enum('topup','deposit_withdraw') DEFAULT 'topup' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `depositFeeEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `depositFeeAmount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `depositFeeMin` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `depositFeeMax` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `withdrawEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `withdrawalInstructions` text;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `cityLabel` varchar(60) DEFAULT 'المدينة' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `cityPlaceholder` varchar(120) DEFAULT 'أدخل المدينة' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `streetLabel` varchar(60) DEFAULT 'الشارع' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `streetPlaceholder` varchar(120) DEFAULT 'أدخل الشارع' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `withdrawalCodeLabel` varchar(80) DEFAULT 'أدخل كود السحب' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_games` ADD `userIdFieldLabel` varchar(60) DEFAULT 'ID المستخدم' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_requests` ADD `kind` enum('topup','deposit','withdraw') DEFAULT 'topup' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_requests` ADD `city` varchar(160);--> statement-breakpoint
ALTER TABLE `game_topup_requests` ADD `street` varchar(240);--> statement-breakpoint
ALTER TABLE `game_topup_requests` ADD `withdrawalCode` varchar(160);