ALTER TABLE `users` ADD `birthDate` varchar(10);--> statement-breakpoint
ALTER TABLE `users` ADD `nationalIdCiphertext` text;--> statement-breakpoint
ALTER TABLE `users` ADD `nationalIdLast4` varchar(4);