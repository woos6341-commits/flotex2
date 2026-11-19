CREATE TABLE `broker_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(80) NOT NULL,
	`eventId` varchar(180) NOT NULL,
	`eventType` varchar(80) NOT NULL,
	`brokerOrderId` varchar(150),
	`payload` text NOT NULL,
	`status` enum('received','processed','rejected') NOT NULL DEFAULT 'received',
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `broker_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `broker_events_eventId_unique` UNIQUE(`eventId`)
);
--> statement-breakpoint
CREATE INDEX `broker_events_provider_order_idx` ON `broker_events` (`provider`,`brokerOrderId`);