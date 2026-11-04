ALTER TABLE `discord_boards` ADD `game_on_day` text;--> statement-breakpoint
ALTER TABLE `discord_boards` ADD `game_on_message_id` text;--> statement-breakpoint
ALTER TABLE `discord_boards` ADD `game_on_hash` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `game_on_posts` integer DEFAULT false NOT NULL;