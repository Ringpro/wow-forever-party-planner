CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`realm` text,
	`faction` text NOT NULL,
	`class` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`is_main` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `characters_user` ON `characters` (`user_id`);--> statement-breakpoint
DROP INDEX `availability_entries_user_date`;--> statement-breakpoint
ALTER TABLE `availability_entries` ADD `slot` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `availability_entries_user_date_slot` ON `availability_entries` (`user_id`,`local_date`,`slot`);--> statement-breakpoint
CREATE TABLE `__new_weekly_defaults` (
	`user_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`slot` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`start_local` text,
	`end_local` text,
	`tz` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `weekday`, `slot`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_weekly_defaults`("user_id", "weekday", "slot", "status", "start_local", "end_local", "tz", "updated_at") SELECT "user_id", "weekday", 0, "status", "start_local", "end_local", "tz", "updated_at" FROM `weekly_defaults`;--> statement-breakpoint
DROP TABLE `weekly_defaults`;--> statement-breakpoint
ALTER TABLE `__new_weekly_defaults` RENAME TO `weekly_defaults`;--> statement-breakpoint
ALTER TABLE `group_memberships` ADD `source` text DEFAULT 'invite' NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `discord_guild_id` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `discord_role_id` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `parent_group_id` text REFERENCES groups(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `groups` ADD `icon_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `groups_server_guild` ON `groups` (`discord_guild_id`) WHERE parent_group_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX `groups_squad_role` ON `groups` (`parent_group_id`,`discord_role_id`);