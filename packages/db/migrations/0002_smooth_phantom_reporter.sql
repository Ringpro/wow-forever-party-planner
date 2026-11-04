ALTER TABLE `group_memberships` ADD `share_decided_at` integer;--> statement-breakpoint
-- Invite memberships were joined with an explicit sharing choice.
UPDATE `group_memberships` SET `share_decided_at` = `joined_at` WHERE `source` = 'invite';
