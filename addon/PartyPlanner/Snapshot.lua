-- A snapshot of the logged-in character: level, zone and active quests, with when it was taken.
local _, ns = ...

--- "Name-Realm", the same form addon messages use for the sender.
function ns.CharacterKey()
  local name, realm = UnitFullName("player")
  return name .. "-" .. (realm or GetNormalizedRealmName() or "")
end

local function activeQuests()
  local quests = {}
  for index = 1, C_QuestLog.GetNumQuestLogEntries() do
    local info = C_QuestLog.GetInfo(index)
    if info and not info.isHeader and not info.isHidden and info.questID and info.questID > 0 then
      table.insert(quests, {
        id = info.questID,
        title = info.title,
        level = info.level,
        done = C_QuestLog.IsComplete(info.questID) or false,
      })
    end
  end
  table.sort(quests, function(a, b)
    return a.id < b.id
  end)
  return quests
end

function ns.TakeSnapshot()
  local name, realm = UnitFullName("player")
  local _, class = UnitClass("player")
  local _, race = UnitRace("player")
  local snapshot = {
    name = name,
    realm = realm or GetNormalizedRealmName(),
    class = class,
    race = race,
    faction = UnitFactionGroup("player"),
    level = UnitLevel("player"),
    zone = GetRealZoneText(),
    quests = activeQuests(),
    observedAt = time(),
    source = "addon",
    addonVersion = ns.version,
  }
  ns.current = snapshot
  ns.db.characters[ns.CharacterKey()] = snapshot
  if ns.OnSnapshot then
    ns.OnSnapshot(snapshot)
  end
  return snapshot
end

--- Set of quest IDs in the current snapshot.
function ns.MyQuestIds()
  local ids = {}
  for _, quest in ipairs((ns.current or ns.TakeSnapshot()).quests) do
    ids[quest.id] = quest
  end
  return ids
end

local refresh = ns.Debounce(2, function()
  ns.TakeSnapshot()
end)

ns.On("PLAYER_LOGIN", function()
  ns.TakeSnapshot()
end)
ns.On("QUEST_LOG_UPDATE", refresh)
ns.On("PLAYER_LEVEL_UP", refresh)
ns.On("ZONE_CHANGED_NEW_AREA", refresh)
