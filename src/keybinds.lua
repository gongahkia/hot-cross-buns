local Settings = require("src.settings")

local Keybinds = {}

function Keybinds.key(settings, action)
    return settings and settings.controls and settings.controls[action]
end

function Keybinds.isDown(settings, action)
    local key = Keybinds.key(settings, action)
    return key and love.keyboard.isDown(key) or false
end

function Keybinds.actionForKey(settings, key)
    for _, action in ipairs(Settings.controlOrder()) do
        if Keybinds.key(settings, action) == key then return action end
    end
    return nil
end

function Keybinds.conflict(settings, action, key)
    for _, other in ipairs(Settings.controlOrder()) do
        if other ~= action and Keybinds.key(settings, other) == key then return other end
    end
    return nil
end

function Keybinds.rebind(settings, action, key)
    local duplicate = Keybinds.conflict(settings, action, key)
    if duplicate then return false, duplicate end
    settings.controls[action] = key
    return true
end

return Keybinds
