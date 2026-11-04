-- Shared namespace, event dispatch, saved data and small helpers.
local addonName, ns = ...

ns.version = C_AddOns.GetAddOnMetadata(addonName, "Version") or "dev"

local frame = CreateFrame("Frame")
local handlers = {}

--- Registers a handler for a game event. Several handlers per event are fine.
function ns.On(event, handler)
  if not handlers[event] then
    handlers[event] = {}
    frame:RegisterEvent(event)
  end
  table.insert(handlers[event], handler)
end

frame:SetScript("OnEvent", function(_, event, ...)
  for _, handler in ipairs(handlers[event]) do
    handler(...)
  end
end)

--- Returns a function that runs `fn` once, `delay` seconds after the last call.
function ns.Debounce(delay, fn)
  local timer
  return function()
    if timer then
      timer:Cancel()
    end
    timer = C_Timer.NewTimer(delay, function()
      timer = nil
      fn()
    end)
  end
end

function ns.Print(message)
  print("|cffe3b341Muster|r " .. message)
end

ns.On("ADDON_LOADED", function(name)
  if name ~= addonName then
    return
  end
  MusterDB = MusterDB or {}
  MusterDB.schema = 1
  MusterDB.characters = MusterDB.characters or {}
  MusterDB.settings = MusterDB.settings or { share = true }
  ns.db = MusterDB
end)
