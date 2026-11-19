ALTER TABLE `transactions` ADD `direction` enum('credit','debit');--> statement-breakpoint
ALTER TABLE `transactions` ADD `customerTitle` varchar(40);--> statement-breakpoint
ALTER TABLE `transactions` ADD `customerDescription` varchar(160);--> statement-breakpoint
ALTER TABLE `transactions` ADD `source` varchar(40);--> statement-breakpoint
ALTER TABLE `transactions` ADD `balanceBefore` decimal(14,2);--> statement-breakpoint
ALTER TABLE `transactions` ADD `balanceAfter` decimal(14,2);--> statement-breakpoint
UPDATE `transactions` SET
  `direction` = CASE WHEN `amount` < 0 OR `type` IN ('withdrawal','loss') THEN 'debit' ELSE 'credit' END,
  `customerTitle` = CASE
    WHEN `type` = 'withdrawal' THEN 'سحب'
    WHEN `type` IN ('profit','loss') THEN CASE WHEN `amount` < 0 OR `type` = 'loss' THEN 'خسائر' ELSE 'أرباح' END
    WHEN `amount` < 0 THEN 'خصم' ELSE 'إيداع' END,
  `customerDescription` = CASE
    WHEN `status` = 'pending' THEN 'العملية قيد المراجعة'
    WHEN `status` = 'rejected' THEN 'تم رفض العملية ولم يتغير الرصيد'
    WHEN `type` = 'withdrawal' THEN 'تم سحب الأموال'
    WHEN `amount` < 0 OR `type` = 'loss' THEN 'تم خصم الأموال' ELSE 'تمت إضافة الأموال' END,
  `source` = CASE WHEN `type` = 'adjustment' THEN 'admin_adjustment' ELSE 'legacy' END
WHERE `direction` IS NULL;--> statement-breakpoint
UPDATE `transactions` AS t JOIN `audit_logs` AS a
ON a.`targetUserId` = t.`userId` AND (a.`operationId` = t.`reference` OR a.`operationId` = CONCAT('review:', t.`reference`))
SET t.`balanceBefore` = a.`balanceBefore`, t.`balanceAfter` = a.`balanceAfter`
WHERE t.`status` = 'approved' AND t.`balanceBefore` IS NULL AND t.`balanceAfter` IS NULL
AND a.`balanceAfter` - a.`balanceBefore` = CASE WHEN t.`amount` < 0 OR t.`type` IN ('withdrawal','loss') THEN -ABS(t.`amount`) ELSE ABS(t.`amount`) END;
