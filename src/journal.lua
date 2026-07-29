local UI = require("src.ui")
local Survey = require("src.survey")

local Journal = {}

local function theme()
    local t = UI.defaultTheme()
    t.fill = { 0.025, 0.035, 0.035, 0.94 }
    t.fillHot = { 0.08, 0.11, 0.09, 0.96 }
    t.fillActive = { 0.13, 0.17, 0.13, 0.98 }
    t.border = { 0.42, 0.48, 0.38, 1 }
    t.text = { 0.86, 0.86, 0.76, 1 }
    t.muted = { 0.54, 0.62, 0.52, 1 }
    return t
end

local function contains(x, y, w, h, px, py)
    return px >= x and px <= x + w and py >= y and py <= y + h
end

local function titleCase(value)
    return (tostring(value or "feature"):gsub("_", " "):gsub("(%a)([%w']*)", function(first, rest)
        return string.upper(first) .. string.lower(rest)
    end))
end

function Journal.new()
    return {
        ui = UI.new(theme()),
        scroll = 0,
    }
end

function Journal.entries(survey)
    local out = {}
    for _, pin in ipairs(Survey.pinEntries(survey)) do
        out[#out + 1] = {
            type = "pin",
            key = pin.key,
            label = pin.label or ("Pin " .. tostring(pin.id)),
            detail = string.format("%s  %d,%d", tostring(pin.scale or "local"), math.floor(pin.x or 0), math.floor(pin.y or 0)),
            x = pin.x,
            y = pin.y,
            scale = pin.scale,
            pin = pin,
        }
    end
    for _, discovery in ipairs(Survey.discoveryEntries(survey)) do
        out[#out + 1] = {
            type = "discovery",
            key = discovery.key,
            label = discovery.name or titleCase(discovery.kind),
            detail = titleCase(discovery.kind) .. string.format("  %d,%d", math.floor(discovery.x or 0), math.floor(discovery.y or 0)),
            x = discovery.x,
            y = discovery.y,
            scale = discovery.scale,
            discovery = discovery,
        }
    end
    return out
end

function Journal.teleport(app, target, preload)
    if not (app and app.player and target and target.x and target.y) then return false end
    app.player.x = target.x
    app.player.y = target.y
    app.player.vx = 0
    app.player.vy = 0
    app.player.stumbleCooldown = 0
    app.player.footstepPhase = 0
    app.player.footstepTotal = 0
    app.minimapCache = nil
    if app.camera then app.camera.eyeZ = nil end
    if preload then preload(app, "teleport") end
    return true
end

function Journal.draw(journal, app, width, height)
    journal = journal or Journal.new()
    local ui = journal.ui
    UI.begin(ui)
    local w = math.min(620, width - 48)
    local h = math.min(480, height - 56)
    local x = math.floor((width - w) * 0.5)
    local y = math.floor((height - h) * 0.5)
    love.graphics.setColor(0.015, 0.02, 0.02, 0.72)
    love.graphics.rectangle("fill", 0, 0, width, height)
    love.graphics.setColor(0.025, 0.035, 0.035, 0.96)
    love.graphics.rectangle("fill", x, y, w, h)
    love.graphics.setColor(0.42, 0.48, 0.38, 1)
    love.graphics.rectangle("line", x + 0.5, y + 0.5, w - 1, h - 1)
    local survey = app.survey or {}
    UI.Label(ui, "Journal", x + 18, y + 14, { size = 22 })
    UI.Label(ui, string.format("survey %d:%d:%d", survey.cellCount or 0, survey.discoveryCount or 0, survey.pinCount or 0), x + 18, y + 42, { size = 13, muted = true })
    local entries = Journal.entries(survey)
    local listX, listY = x + 14, y + 68
    local listW, listH = w - 28, h - 86
    local rowH = 46
    local maxScroll = math.max(0, #entries * rowH - listH)
    if contains(listX, listY, listW, listH, ui.mouseX, ui.mouseY) and ui.wheelY ~= 0 then
        journal.scroll = math.max(0, math.min(maxScroll, (journal.scroll or 0) - ui.wheelY * rowH))
    end
    love.graphics.setColor(0.035, 0.045, 0.04, 0.88)
    love.graphics.rectangle("fill", listX, listY, listW, listH)
    love.graphics.setColor(0.26, 0.32, 0.26, 1)
    love.graphics.rectangle("line", listX + 0.5, listY + 0.5, listW - 1, listH - 1)
    love.graphics.setScissor(listX, listY, listW, listH)
    local action
    for index, entry in ipairs(entries) do
        local rowY = listY + (index - 1) * rowH - (journal.scroll or 0)
        if rowY + rowH >= listY and rowY <= listY + listH then
            love.graphics.setColor(index % 2 == 0 and 0.045 or 0.035, 0.055, 0.048, 0.82)
            love.graphics.rectangle("fill", listX + 4, rowY + 4, listW - 8, rowH - 8)
            UI.Label(ui, entry.label, listX + 12, rowY + 8, { size = 14 })
            UI.Label(ui, entry.detail, listX + 12, rowY + 26, { size = 11, muted = true })
            if UI.Button(ui, "Go", listX + listW - 104, rowY + 10, 42, 26, { id = "journal:go:" .. tostring(entry.key), size = 12 }) then
                action = { type = "teleport", target = entry, key = entry.key }
            end
            if entry.type == "pin" and UI.Button(ui, "Del", listX + listW - 56, rowY + 10, 42, 26, { id = "journal:del:" .. tostring(entry.key), size = 12, danger = true }) then
                action = { type = "delete_pin", key = entry.key }
            end
        end
    end
    love.graphics.setScissor()
    if #entries == 0 then UI.Label(ui, "No survey entries", listX + 14, listY + 14, { size = 14, muted = true }) end
    UI.finish(ui)
    return action
end

function Journal.mousepressed(journal, x, y, button)
    if journal and journal.ui then UI.mousepressed(journal.ui, x, y, button) end
end

function Journal.mousereleased(journal, x, y, button)
    if journal and journal.ui then UI.mousereleased(journal.ui, x, y, button) end
end

function Journal.wheelmoved(journal, x, y)
    if journal and journal.ui then UI.wheelmoved(journal.ui, x, y) end
end

return Journal
