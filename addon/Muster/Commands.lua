-- Slash command: /muster.
local _, ns = ...

local function displayName(sender)
  return Ambiguate(sender, "short")
end

local function questTitle(id, mine)
  if mine[id] then
    return mine[id].title
  end
  return C_QuestLog.GetTitleForQuestID(id) or ("quest " .. id)
end

local function showStatus()
  local s = ns.TakeSnapshot()
  ns.Print(string.format("Level %d %s in %s, %d active quests.", s.level, s.class or "", s.zone or "?", #s.quests))
  local count = 0
  for sender, peer in pairs(ns.peers) do
    count = count + 1
    ns.Print(string.format("  %s: level %s, %d active quests", displayName(sender), peer.level or "?", ns.CountKeys(peer.quests)))
  end
  if count == 0 then
    ns.Print(IsInGroup() and "No one else in your group runs Muster yet." or "Join a group to compare quests.")
  end
  if not ns.db.settings.share then
    ns.Print("Sharing is off. Turn it on with /muster share on.")
  end
end

local function showShared()
  local mine = ns.MyQuestIds()
  local any = false
  for sender, peer in pairs(ns.peers) do
    any = true
    local shared, theirs = {}, {}
    for id in pairs(peer.quests) do
      table.insert(mine[id] and shared or theirs, id)
    end
    table.sort(shared)
    table.sort(theirs)
    ns.Print(string.format("With %s: %d shared quests", displayName(sender), #shared))
    for _, id in ipairs(shared) do
      ns.Print("  = " .. questTitle(id, mine))
    end
    if #theirs > 0 then
      ns.Print(string.format("  They also have %d you don't:", #theirs))
      for _, id in ipairs(theirs) do
        ns.Print("  + " .. questTitle(id, mine))
      end
    end
  end
  if not any then
    ns.Print("No group members with Muster to compare with.")
  end
end

local function setSharing(value)
  if value == "on" then
    ns.db.settings.share = true
    ns.Print("Sharing on: your level, class and quest IDs go to group members who run Muster.")
    ns.SendStatus()
  elseif value == "off" then
    ns.db.settings.share = false
    ns.SendBye()
    ns.Print("Sharing off. Group members will stop seeing your quests.")
  else
    ns.Print("Sharing is " .. (ns.db.settings.share and "on" or "off") .. ". Use /muster share on or /muster share off.")
  end
end

function ns.CountKeys(set)
  local n = 0
  for _ in pairs(set) do
    n = n + 1
  end
  return n
end

SLASH_MUSTER1 = "/muster"
SlashCmdList.MUSTER = function(input)
  local command, rest = strsplit(" ", strtrim(input or ""):lower(), 2)
  if command == "" then
    showStatus()
  elseif command == "shared" then
    showShared()
  elseif command == "share" then
    setSharing(rest)
  else
    ns.Print("/muster: your status · /muster shared: quests you share with your group · /muster share on|off")
  end
end
