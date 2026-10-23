-- Sharing level, class and active quest IDs with group members who also run the addon.
--
-- Messages (prefix "PartyPlnr", fields separated by ";"):
--   S1;<seq>;<part>;<parts>;<level>;<class>;<id,id,...>   status, split into parts that fit one message
--   R1                                                      "please send me your status"
--   B1                                                      "I stopped sharing, forget my data"
local _, ns = ...

local PREFIX = "PartyPlnr"
local MAX_IDS_LENGTH = 180
local SUCCESS = Enum.SendAddonMessageResult and Enum.SendAddonMessageResult.Success or 0

ns.peers = {} -- [sender] = { level, class, quests = { [id] = true }, seenAt }
local pending = {} -- [sender] = { seq, parts, received, chunks = {} }
local sequence = 0
local resendAfterCombat = false

C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)

local function groupChannel()
  if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
    return "INSTANCE_CHAT"
  elseif IsInRaid() then
    return "RAID"
  elseif IsInGroup() then
    return "PARTY"
  end
end

local function send(message)
  local channel = groupChannel()
  if not channel then
    return true
  end
  local result = C_ChatInfo.SendAddonMessage(PREFIX, message, channel)
  -- Older clients return a boolean, newer ones a result enum.
  return result == true or result == SUCCESS
end

--- Splits a list of quest IDs into comma-separated strings that fit in one message each.
function ns.ChunkIds(ids)
  local chunks, current = {}, ""
  for _, id in ipairs(ids) do
    local piece = tostring(id)
    if current ~= "" and #current + 1 + #piece > MAX_IDS_LENGTH then
      table.insert(chunks, current)
      current = piece
    else
      current = current == "" and piece or (current .. "," .. piece)
    end
  end
  table.insert(chunks, current)
  return chunks
end

local function sendStatus()
  if not ns.db or not ns.db.settings.share or not groupChannel() then
    return
  end
  local snapshot = ns.current or ns.TakeSnapshot()
  local ids = {}
  for _, quest in ipairs(snapshot.quests) do
    table.insert(ids, quest.id)
  end
  sequence = (sequence % 999) + 1
  local chunks = ns.ChunkIds(ids)
  for index, chunk in ipairs(chunks) do
    local message = table.concat({ "S1", sequence, index, #chunks, snapshot.level, snapshot.class or "", chunk }, ";")
    if not send(message) then
      -- Blocked (for example during an encounter); try again once combat ends.
      resendAfterCombat = true
      return
    end
  end
end

ns.SendStatus = ns.Debounce(3, sendStatus)

function ns.RequestStatus()
  send("R1")
end

function ns.SendBye()
  send("B1")
end

local function parseIds(text)
  local set = {}
  for id in string.gmatch(text or "", "%d+") do
    set[tonumber(id)] = true
  end
  return set
end

local function onStatusPart(sender, fields)
  local seq, part, parts = tonumber(fields[2]), tonumber(fields[3]), tonumber(fields[4])
  if not seq or not part or not parts or part < 1 or part > parts or parts > 20 then
    return
  end
  local entry = pending[sender]
  if not entry or entry.seq ~= seq then
    entry = { seq = seq, parts = parts, received = 0, chunks = {} }
    pending[sender] = entry
  end
  if not entry.chunks[part] then
    entry.chunks[part] = fields[7] or ""
    entry.received = entry.received + 1
  end
  if entry.received == entry.parts then
    pending[sender] = nil
    ns.peers[sender] = {
      level = tonumber(fields[5]),
      class = fields[6] ~= "" and fields[6] or nil,
      quests = parseIds(table.concat(entry.chunks, ",")),
      seenAt = time(),
    }
  end
end

ns.On("CHAT_MSG_ADDON", function(prefix, text, _, sender)
  if prefix ~= PREFIX or sender == ns.CharacterKey() then
    return
  end
  local fields = { strsplit(";", text) }
  local kind = fields[1]
  if kind == "S1" then
    onStatusPart(sender, fields)
  elseif kind == "R1" then
    ns.SendStatus()
  elseif kind == "B1" then
    ns.peers[sender] = nil
    pending[sender] = nil
  end
end)

local function inGroup(sender)
  local name = Ambiguate(sender, "none")
  return UnitInParty(name) or UnitInRaid(name)
end

-- Roster updates come in bursts; settle first, then drop people who left and say hello to the rest.
ns.On(
  "GROUP_ROSTER_UPDATE",
  ns.Debounce(2, function()
    for sender in pairs(ns.peers) do
      if not inGroup(sender) then
        ns.peers[sender] = nil
      end
    end
    if IsInGroup() then
      ns.RequestStatus()
      ns.SendStatus()
    end
  end)
)

-- After logging in or /reload while already grouped, no roster update fires, so ask for
-- everyone's status ourselves (our own goes out via the login snapshot).
ns.On("PLAYER_LOGIN", function()
  if IsInGroup() then
    ns.RequestStatus()
  end
end)

ns.On("PLAYER_REGEN_ENABLED", function()
  if resendAfterCombat then
    resendAfterCombat = false
    ns.SendStatus()
  end
end)

-- Share again whenever our own snapshot changes.
ns.OnSnapshot = function()
  ns.SendStatus()
end
