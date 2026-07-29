local Save = require("src.save")

local Settings = {}
local settingsPath = "settings.json"

local defaults = {
    controls = {
        forward = "w",
        back = "s",
        left = "a",
        right = "d",
        sprint = "lshift",
        lookRight = "e",
        lookLeft = "left",
        pitchUp = "up",
        pitchDown = "down",
        quit = "escape",
        quitAlt = "q",
        toggleMouseLook = "f",
        togglePerf = "l",
        togglePlayerHud = "h",
        toggleTopo = "t",
        toggleMinimap = "m",
        togglePanels = "b",
        panelPlate = "1",
        panelDrainage = "2",
        panelErosion = "3",
        panelBiome = "4",
        toggleTopoAlt = "5",
        seasonPrev = "[",
        seasonNext = "]",
        save = "f5",
        load = "f9",
        markSurvey = "n",
        toggleJournal = "j",
        dropPin = "p",
        newSeed = "r",
    },
    display = {
        pixelScale = 2,
        dayLength = 60,
        startSeason = "summer",
        mouseSensitivityX = 0.0025,
        mouseSensitivityY = 0.0018,
        headBob = false,
        cameraSway = false,
        showWorldLabels = true,
        showAreaLabels = true,
        showPlayerHud = true,
    },
    audio = {
        master = 1,
        sfx = 1,
        ambient = 1,
    },
    debug = {
        perf = false,
        topo = false,
        minimap = false,
        panels = false,
    },
}

local labels = {
    forward = "Forward",
    back = "Back",
    left = "Left",
    right = "Right",
    sprint = "Sprint",
    lookRight = "Look Right",
    lookLeft = "Look Left",
    pitchUp = "Pitch Up",
    pitchDown = "Pitch Down",
    quit = "Quit",
    quitAlt = "Quit Alt",
    toggleMouseLook = "Mouse Look",
    togglePerf = "Perf HUD",
    togglePlayerHud = "Player HUD",
    toggleTopo = "Topo",
    toggleMinimap = "Minimap",
    togglePanels = "Panels",
    panelPlate = "Plate Panel",
    panelDrainage = "Drainage Panel",
    panelErosion = "Erosion Panel",
    panelBiome = "Biome Panel",
    toggleTopoAlt = "Topo Alt",
    seasonPrev = "Season Prev",
    seasonNext = "Season Next",
    save = "Save",
    load = "Load",
    markSurvey = "Mark",
    toggleJournal = "Journal",
    dropPin = "Drop Pin",
    newSeed = "New Seed",
}

local controlOrder = {
    "forward", "back", "left", "right", "sprint",
    "lookRight", "lookLeft", "pitchUp", "pitchDown",
    "toggleMouseLook", "togglePerf", "togglePlayerHud", "toggleTopo", "toggleMinimap", "togglePanels",
    "panelPlate", "panelDrainage", "panelErosion", "panelBiome", "toggleTopoAlt",
    "seasonPrev", "seasonNext", "save", "load", "markSurvey", "toggleJournal", "dropPin", "newSeed", "quit", "quitAlt",
}

local function copy(value)
    if type(value) ~= "table" then return value end
    local out = {}
    for k, v in pairs(value) do out[k] = copy(v) end
    return out
end

local function merge(base, overlay)
    local out = copy(base)
    for key, value in pairs(overlay or {}) do
        if type(value) == "table" and type(out[key]) == "table" then out[key] = merge(out[key], value) else out[key] = value end
    end
    return out
end

function Settings.defaults()
    return copy(defaults)
end

function Settings.controlOrder()
    return controlOrder
end

function Settings.label(action)
    return labels[action] or action
end

function Settings.load()
    if not (love and love.filesystem) then return Settings.defaults() end
    local info = love.filesystem.getInfo(settingsPath)
    if not info then return Settings.defaults() end
    local ok, decoded = pcall(function() return Save.decode(love.filesystem.read(settingsPath)) end)
    if not ok or type(decoded) ~= "table" then return Settings.defaults() end
    return merge(defaults, decoded)
end

function Settings.save(settings)
    if not (love and love.filesystem) then return false end
    return love.filesystem.write(settingsPath, Save.encode(merge(defaults, settings or {})) .. "\n")
end

return Settings
