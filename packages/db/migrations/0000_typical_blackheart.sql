CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `availability_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`status` text NOT NULL,
	`start_local` text,
	`end_local` text,
	`tz` text NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`share_scope` text DEFAULT 'all_shared_groups' NOT NULL,
	`source` text NOT NULL,
	`last_relative_shift_at` integer,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `availability_entries_user_date` ON `availability_entries` (`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `availability_entry_groups` (
	`entry_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `group_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `availability_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `discord_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`dirty_since` integer,
	`last_rendered_at` integer,
	`last_render_hash` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_boards_channel_id_unique` ON `discord_boards` (`channel_id`);--> statement-breakpoint
CREATE TABLE `free_now` (
	`user_id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `group_invites` (
	`token` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`created_by` text,
	`expires_at` integer,
	`max_uses` integer,
	`uses` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `group_memberships` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`share_availability` integer DEFAULT true NOT NULL,
	`joined_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_memberships_user` ON `group_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`min_players` integer DEFAULT 3 NOT NULL,
	`min_overlap_minutes` integer DEFAULT 60 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`username` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_provider_external` ON `user_identities` (`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`timezone` text,
	`default_session_minutes` integer DEFAULT 120 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_defaults` (
	`user_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`status` text NOT NULL,
	`start_local` text,
	`end_local` text,
	`tz` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `weekday`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
