-- A small stand-in for the parts of the WoW client API the addon uses. One copy runs per
-- simulated player. Tests change `Fake` to set up the world, then fire events and move the clock.

Fake = {
  now = 0,
  time = 1793000000,
  player = {
    name = "Anders",
    realm = "Firemaw",
    class = "WARRIOR",
    race = "Human",
    faction = "Alliance",
    level = 20,
    zone = "Elwynn Forest",
  },
  quests = {}, -- quest log rows: { questID, title, level, isComplete, isHeader, isHidden }
  titles = {}, -- [questID] = title, for quests not in our own log
  group = nil, -- nil, "PARTY", "RAID" or "INSTANCE_CHAT"
  members = {}, -- [name as Ambiguate(sender, "none") returns it] = true
  combat = false,
  blockSends = false,
  sent = {}, -- every addon message we sent: { prefix, msg, channel }
  printed = {},
}

-- Events and frames ------------------------------------------------------------------

local frames = {}

function CreateFrame()
  local frame = { events = {} }
  function frame:RegisterEvent(event)
    self.events[event] = true
  end
  function frame:SetScript(_, handler)
    self.onEvent = handler
  end
  table.insert(frames, frame)
  return frame
end

function Fake.Fire(event, ...)
  for _, frame in ipairs(frames) do
    if frame.events[event] and frame.onEvent then
      frame.onEvent(frame, event, ...)
    end
  end
end

-- Timers -----------------------------------------------------------------------------

local timers = {}

C_Timer = {
  NewTimer = function(delay, callback)
    local timer = { due = Fake.now + delay, callback = callback }
    function timer:Cancel()
      self.cancelled = true
    end
    table.insert(timers, timer)
    return timer
  end,
}

function Fake.Advance(seconds)
  local target = Fake.now + seconds
  while true do
    local nextTimer
    for _, timer in ipairs(timers) do
      if not timer.cancelled and not timer.done and timer.due <= target then
        if not nextTimer or timer.due < nextTimer.due then
          nextTimer = timer
        end
      end
    end
    if not nextTimer then
      break
    end
    Fake.time = Fake.time + (nextTimer.due - Fake.now)
    Fake.now = nextTimer.due
    nextTimer.done = true
    nextTimer.callback()
  end
  Fake.time = Fake.time + (target - Fake.now)
  Fake.now = target
end

-- Addon metadata, quests, chat -------------------------------------------------------

C_AddOns = {
  GetAddOnMetadata = function()
    return "0.1.0-test"
  end,
}

C_QuestLog = {
  GetNumQuestLogEntries = function()
    return #Fake.quests
  end,
  GetInfo = function(index)
    return Fake.quests[index]
  end,
  IsComplete = function(questID)
    for _, quest in ipairs(Fake.quests) do
      if quest.questID == questID then
        return quest.isComplete == true
      end
    end
    return false
  end,
  GetTitleForQuestID = function(questID)
    return Fake.titles[questID]
  end,
}

Enum = { SendAddonMessageResult = { Success = 0, AddonMessageThrottle = 3 } }

C_ChatInfo = {
  RegisterAddonMessagePrefix = function(prefix)
    Fake.prefix = prefix
    return true
  end,
  SendAddonMessage = function(prefix, message, channel)
    if #prefix > 16 then
      error("prefix too long")
    end
    if #message > 255 then
      error("addon message too long: " .. #message .. " bytes")
    end
    if Fake.blockSends then
      return Enum.SendAddonMessageResult.AddonMessageThrottle
    end
    table.insert(Fake.sent, { prefix = prefix, msg = message, channel = channel })
    __deliver(prefix, message, channel)
    return Enum.SendAddonMessageResult.Success
  end,
}

-- Units and groups -------------------------------------------------------------------

LE_PARTY_CATEGORY_INSTANCE = 2

function IsInGroup(category)
  if category == LE_PARTY_CATEGORY_INSTANCE then
    return Fake.group == "INSTANCE_CHAT"
  end
  return Fake.group ~= nil
end

function IsInRaid()
  return Fake.group == "RAID"
end

function UnitInParty(name)
  return Fake.group ~= nil and Fake.members[name] == true
end

function UnitInRaid(name)
  if Fake.group == "RAID" and Fake.members[name] then
    return 1
  end
  return nil
end

function UnitFullName()
  return Fake.player.name, Fake.player.realm
end

function GetNormalizedRealmName()
  return Fake.player.realm
end

function UnitClass()
  return Fake.player.class:sub(1, 1) .. Fake.player.class:sub(2):lower(), Fake.player.class
end

function UnitRace()
  return Fake.player.race, Fake.player.race
end

function UnitFactionGroup()
  return Fake.player.faction
end

function UnitLevel()
  return Fake.player.level
end

function GetRealZoneText()
  return Fake.player.zone
end

function InCombatLockdown()
  return Fake.combat
end

--- Like WoW: "short" drops the realm; "none" drops it only for players on our own realm.
function Ambiguate(fullName, context)
  local name, realm = fullName:match("^([^-]+)-(.+)$")
  if not name then
    return fullName
  end
  if context == "short" or realm == Fake.player.realm then
    return name
  end
  return fullName
end

-- Lua helpers WoW adds -----------------------------------------------------------------

function strsplit(delimiter, text, limit)
  local parts, start = {}, 1
  while true do
    if limit and #parts == limit - 1 then
      table.insert(parts, text:sub(start))
      break
    end
    local at = text:find(delimiter, start, true)
    if not at then
      table.insert(parts, text:sub(start))
      break
    end
    table.insert(parts, text:sub(start, at - 1))
    start = at + 1
  end
  return table.unpack(parts)
end

function strtrim(text)
  return (text:gsub("^%s+", ""):gsub("%s+$", ""))
end

function time()
  return Fake.time
end

function print(...)
  local parts = {}
  for i = 1, select("#", ...) do
    parts[i] = tostring(select(i, ...))
  end
  -- Drop WoW colour codes so tests can match plain text.
  local line = table.concat(parts, " "):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
  table.insert(Fake.printed, line)
end

SlashCmdList = {}

-- Loading the addon and reading state back ---------------------------------------------

ADDON_NS = {}

function Fake.Load(fileName, source)
  local chunk = assert(load(source, "@" .. fileName))
  chunk("PartyPlanner", ADDON_NS)
end

function Fake.Slash(input)
  Fake.printed = {}
  SlashCmdList.PARTYPLANNER(input)
  return table.concat(Fake.printed, "\n")
end

local function encode(value)
  local kind = type(value)
  if kind == "nil" then
    return "null"
  elseif kind == "boolean" or kind == "number" then
    return tostring(value)
  elseif kind == "string" then
    return (string.format("%q", value):gsub("\\\n", "\\n"))
  elseif kind == "table" then
    local isArray = #value > 0 or next(value) == nil
    local parts = {}
    if isArray then
      for _, item in ipairs(value) do
        table.insert(parts, encode(item))
      end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for key, item in pairs(value) do
      if type(item) ~= "function" then
        table.insert(parts, string.format("%q", tostring(key)) .. ":" .. encode(item))
      end
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

--- JSON for the test harness (tables of plain data only).
function Fake.Json(value)
  return encode(value)
end
