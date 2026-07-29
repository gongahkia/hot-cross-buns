local HUD = {}

local fontPath = "assets/fonts/BigBlue_Terminal_437TT.TTF"
local tau = math.pi * 2

local function font(app, size)
    app.hudFonts = app.hudFonts or {}
    local key = tostring(size)
    if not app.hudFonts[key] then
        local f = love.filesystem.getInfo(fontPath) and love.graphics.newFont(fontPath, size) or love.graphics.newFont(size)
        if f.setFilter then f:setFilter("nearest", "nearest") end
        app.hudFonts[key] = f
    end
    return app.hudFonts[key]
end

local function displayName(value)
    return (tostring(value or "unknown"):gsub("_", " "):upper())
end

local function wrap(angle)
    return ((angle + math.pi) % tau) - math.pi
end

function HUD.temperatureC(value)
    return math.floor(((tonumber(value) or 0.5) * 45 - 10) + 0.5)
end

function HUD.weatherGlyph(weather)
    weather = weather or {}
    if weather.storm and weather.storm ~= "none" then return "!" end
    local precip = weather.precipitation or "clear"
    if precip == "snow" then return "S" end
    if precip == "sleet" or precip == "hail" or precip == "freezing_rain" then return "*" end
    if precip == "downpour" then return "/" end
    if precip == "rain" or precip == "drizzle" then return ":" end
    return "-"
end

function HUD.compassTicks(yaw)
    yaw = yaw or 0
    local points = {
        { label = "N", angle = 0 },
        { label = "E", angle = math.pi * 0.5 },
        { label = "S", angle = math.pi },
        { label = "W", angle = math.pi * 1.5 },
    }
    local ticks = {}
    for _, point in ipairs(points) do
        local delta = wrap(point.angle - yaw)
        if math.abs(delta) <= math.pi * 0.78 then
            ticks[#ticks + 1] = { label = point.label, offset = delta / (math.pi * 0.5) }
        end
    end
    table.sort(ticks, function(a, b) return a.offset < b.offset end)
    return ticks
end

function HUD.data(app)
    local area = app.currentArea or {}
    local cell
    if app.world and app.player then cell = app.world:sample(math.floor(app.player.x), math.floor(app.player.y), "local") end
    local survey = app.survey or {}
    local weather = app.weatherState or {}
    return {
        area = area.featureName or area.elevationZoneLabel or area.biomeLabel or displayName(cell and cell.biome),
        biome = area.biomeLabel or displayName(area.biome or (cell and cell.biome)),
        weather = HUD.weatherGlyph(weather),
        temperature = HUD.temperatureC(cell and cell.temperature),
        discoveries = survey.discoveryCount or 0,
        pins = survey.pinCount or 0,
        ticks = HUD.compassTicks(app.camera and app.camera.yaw or 0),
    }
end

local function printShadow(text, x, y)
    love.graphics.setColor(0.02, 0.025, 0.03, 0.7)
    love.graphics.print(text, x + 1, y + 1)
    love.graphics.setColor(0.92, 0.9, 0.74, 1)
    love.graphics.print(text, x, y)
end

local function drawCompass(app, width)
    local ticks = HUD.compassTicks(app.camera and app.camera.yaw or 0)
    local cx, y = width * 0.5, 18
    love.graphics.setColor(0.02, 0.025, 0.03, 0.64)
    love.graphics.rectangle("fill", cx - 128, y - 6, 256, 30)
    love.graphics.setColor(0.55, 0.62, 0.48, 0.78)
    love.graphics.line(cx - 112, y + 18, cx + 112, y + 18)
    love.graphics.setFont(font(app, 12))
    for _, tick in ipairs(ticks) do
        local x = cx + tick.offset * 74
        love.graphics.setColor(0.72, 0.78, 0.68, 0.9)
        love.graphics.line(x, y + 12, x, y + 22)
        printShadow(tick.label, x - 4, y)
    end
    love.graphics.setColor(0.95, 0.72, 0.26, 1)
    love.graphics.polygon("fill", cx, y + 24, cx - 5, y + 14, cx + 5, y + 14)
end

function HUD.draw(app, width, height, meshData)
    if app.showPlayerHud == false then return meshData end
    local data = HUD.data(app)
    local topLeftY = app.debugPerf and 262 or 18
    love.graphics.setFont(font(app, 13))
    printShadow(data.area, 18, topLeftY)
    love.graphics.setFont(font(app, 11))
    printShadow(data.biome, 18, topLeftY + 18)
    drawCompass(app, width)
    love.graphics.setFont(font(app, 15))
    local weather = data.weather .. " " .. tostring(data.temperature) .. "C"
    local w = love.graphics.getFont():getWidth(weather)
    printShadow(weather, width - w - 18, 18)
    love.graphics.setFont(font(app, 12))
    printShadow("discoveries " .. tostring(data.discoveries) .. "  pins " .. tostring(data.pins), 18, height - 34)
    if meshData then meshData.playerHud = 1 end
    return meshData
end

return HUD
