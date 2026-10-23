export type MembershipSharing = {
  groupId: string;
  shareAvailability: boolean;
};

export type EntrySharing =
  | { shareScope: "all_shared_groups" }
  | { shareScope: "selected"; groupIds: readonly string[] };

/**
 * Whether a user's availability is visible in a group (architecture §4.2).
 * `entry` is null for weekly defaults, which only follow the membership switch.
 * Callers must show hidden and unanswered the same way ("unknown").
 */
export function visibleInGroup(
  groupId: string,
  membership: MembershipSharing | undefined,
  entry: EntrySharing | null,
): boolean {
  if (!membership || membership.groupId !== groupId || !membership.shareAvailability) return false;
  if (!entry || entry.shareScope === "all_shared_groups") return true;
  return entry.groupIds.includes(groupId);
}
