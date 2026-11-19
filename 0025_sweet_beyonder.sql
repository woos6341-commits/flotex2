ALTER TABLE `savings_plans` ADD `refundEligibleAt` timestamp;--> statement-breakpoint
ALTER TABLE `savings_plans` ADD `cancelledAt` timestamp;--> statement-breakpoint
ALTER TABLE `savings_plans` ADD `refundedAt` timestamp;--> statement-breakpoint
ALTER TABLE `savings_plans` ADD `refundReference` varchar(120);