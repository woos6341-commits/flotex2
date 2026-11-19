CREATE TABLE `ui_button_visibility_global` (
	`id` int AUTO_INCREMENT NOT NULL,
	`surface` enum('home','wallet') NOT NULL,
	`buttonId` varchar(64) NOT NULL,
	`visible` boolean NOT NULL DEFAULT true,
	`reason` text,
	`updatedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ui_button_visibility_global_id` PRIMARY KEY(`id`),
	CONSTRAINT `ui_button_global_surface_button_unique` UNIQUE(`surface`,`buttonId`)
);
--> statement-breakpoint
CREATE TABLE `ui_button_visibility_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorId` int NOT NULL,
	`targetUserId` int,
	`surface` enum('home','wallet') NOT NULL,
	`buttonId` varchar(64) NOT NULL,
	`action` enum('shown','hidden','inherit') NOT NULL,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ui_button_visibility_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ui_button_visibility_user` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`surface` enum('home','wallet') NOT NULL,
	`buttonId` varchar(64) NOT NULL,
	`mode` enum('visible','hidden') NOT NULL,
	`reason` text,
	`updatedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ui_button_visibility_user_id` PRIMARY KEY(`id`),
	CONSTRAINT `ui_button_user_surface_button_unique` UNIQUE(`userId`,`surface`,`buttonId`)
);
--> statement-breakpoint
CREATE INDEX `ui_button_global_updated_by_idx` ON `ui_button_visibility_global` (`updatedBy`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `ui_button_audit_target_created_idx` ON `ui_button_visibility_audit` (`targetUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ui_button_audit_actor_created_idx` ON `ui_button_visibility_audit` (`actorId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ui_button_user_updated_idx` ON `ui_button_visibility_user` (`userId`,`updatedAt`);