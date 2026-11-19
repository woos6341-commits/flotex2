ALTER TABLE `wallets` ADD `reservedWithdrawals` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `wallets` ADD `reservedOrders` decimal(14,2) DEFAULT '0.00' NOT NULL;