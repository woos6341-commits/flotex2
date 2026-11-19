ALTER TABLE `requests` ADD `submittedTransferReference` varchar(150);--> statement-breakpoint
UPDATE `requests` SET `submittedTransferReference` = `transferReference`, `transferReference` = NULL WHERE `transferReference` IS NOT NULL AND (`status` IN ('pending','rejected') OR `type` = 'withdrawal');
