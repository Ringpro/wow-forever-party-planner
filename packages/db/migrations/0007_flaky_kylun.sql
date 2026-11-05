ALTER TABLE `discord_boards` ADD `nudge_week` text;--> statement-breakpoint
ALTER TABLE `discord_boards` ADD `nudge_message_id` text;--> statement-breakpoint
ALTER TABLE `discord_boards` ADD `nudge_hash` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `weekly_nudge` integer DEFAULT false NOT NULL;