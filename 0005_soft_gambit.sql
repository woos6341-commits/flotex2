ALTER TABLE `wallets` MODIFY COLUMN `currency` varchar(8) NOT NULL DEFAULT 'EGP';--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE `cash_ledger` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE `executions` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_quotes` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_transfers` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE `positions` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `currency` varchar(8) DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
INSERT INTO `audit_logs` (`operationId`,`adminId`,`targetUserId`,`amount`,`currency`,`reason`)
SELECT CONCAT('SYS-EGP-BAL-', `id`), 0, `userId`, `balance`, COALESCE(`currency`, 'EGP'), CONCAT('تصحيح العملة إلى الجنيه المصري؛ الرصيد السابق محفوظ، المصدر: ', COALESCE(`currency`, 'EGP'))
FROM `wallets`
WHERE `balance` <> 0 OR COALESCE(`currency`, 'EGP') <> 'EGP';--> statement-breakpoint
INSERT INTO `audit_logs` (`operationId`,`adminId`,`targetUserId`,`amount`,`currency`,`reason`)
SELECT CONCAT('SYS-EGP-PNL-', `id`), 0, `userId`, `profitLoss`, COALESCE(`currency`, 'EGP'), CONCAT('تصفير الأرباح والخسائر السابقة ضمن تصحيح العملة؛ السجل الأصلي محفوظ، المصدر: ', COALESCE(`currency`, 'EGP'))
FROM `wallets`
WHERE `profitLoss` <> 0 OR COALESCE(`currency`, 'EGP') <> 'EGP';--> statement-breakpoint
UPDATE `wallets` SET `balance` = '0.00', `profitLoss` = '0.00', `currency` = 'EGP';--> statement-breakpoint
UPDATE `transactions` SET `currency` = 'EGP', `note` = 'سجل سابق محفوظ — لا يمثل أموالًا فعلية' WHERE `reference` LIKE 'ATH-DEMO-%';