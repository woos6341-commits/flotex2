ALTER TABLE `game_topup_funding_entries` ADD `feeAmount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_requests` ADD `subtotalAmount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_requests` ADD `feeAmount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_settings` ADD `feeEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_settings` ADD `feeAmount` decimal(14,2) DEFAULT '5.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_settings` ADD `feeMin` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_topup_settings` ADD `feeMax` decimal(14,2) DEFAULT '100.00' NOT NULL;