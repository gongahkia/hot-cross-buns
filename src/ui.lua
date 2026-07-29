local UI = {}

local fontPath = "assets/fonts/BigBlue_Terminal_437TT.TTF"

local function clamp(value, minValue, maxValue)
    return math.max(minValue, math.min(maxValue, value))
end

local function contains(x, y, w, h, px, py)
    return px >= x and px <= x + w and py >= y and py <= y + h
end

local function color(theme, key)
    return (theme and theme[key]) or { 1, 1, 1, 1 }
end

local function drawRect(theme, x, y, w, h, fillKey, borderKey)
    love.graphics.setColor(color(theme, fillKey))
    love.graphics.rectangle("fill", x, y, w, h)
    love.graphics.setColor(color(theme, borderKey))
    love.graphics.rectangle("line", x + 0.5, y + 0.5, w - 1, h - 1)
end

function UI.new(theme)
    return {
        theme = theme or UI.defaultTheme(),
        mouseX = 0,
        mouseY = 0,
        mousePressed = false,
        mouseReleased = false,
        active = nil,
        hot = nil,
        focus = nil,
        nextId = 0,
        keys = {},
        text = {},
        wheelY = 0,
        scroll = {},
    }
end

function UI.defaultTheme()
    return {
        text = { 0.82, 0.84, 0.76, 1 },
        muted = { 0.5, 0.55, 0.5, 1 },
        fill = { 0.07, 0.09, 0.09, 0.92 },
        fillHot = { 0.12, 0.16, 0.14, 0.94 },
        fillActive = { 0.18, 0.22, 0.18, 0.96 },
        border = { 0.44, 0.5, 0.42, 1 },
        borderHot = { 0.72, 0.7, 0.48, 1 },
        accent = { 0.82, 0.73, 0.43, 1 },
        shadow = { 0.015, 0.02, 0.02, 0.72 },
        danger = { 0.74, 0.32, 0.26, 1 },
    }
end

function UI.font(ui, size)
    ui.fonts = ui.fonts or {}
    local key = tostring(size)
    if not ui.fonts[key] then
        local font = love.filesystem.getInfo(fontPath) and love.graphics.newFont(fontPath, size) or love.graphics.newFont(size)
        if font.setFilter then font:setFilter("nearest", "nearest") end
        ui.fonts[key] = font
    end
    return ui.fonts[key]
end

function UI.begin(ui)
    ui.mouseX, ui.mouseY = love.mouse.getPosition()
    ui.hot = nil
    ui.nextId = 0
end

function UI.finish(ui)
    ui.mousePressed = false
    ui.mouseReleased = false
    ui.keys = {}
    ui.text = {}
    ui.wheelY = 0
end

function UI.id(ui, hint)
    ui.nextId = ui.nextId + 1
    return tostring(hint or "item") .. ":" .. tostring(ui.nextId)
end

function UI.mousepressed(ui, x, y, button)
    ui.mouseX, ui.mouseY = x, y
    if button == 1 then ui.mousePressed = true end
end

function UI.mousereleased(ui, x, y, button)
    ui.mouseX, ui.mouseY = x, y
    if button == 1 then ui.mouseReleased = true end
end

function UI.keypressed(ui, key)
    ui.keys[key] = true
end

function UI.textinput(ui, text)
    ui.text[#ui.text + 1] = text
end

function UI.wheelmoved(ui, _, y)
    ui.wheelY = ui.wheelY + y
end

function UI.Label(ui, text, x, y, options)
    options = options or {}
    local font = UI.font(ui, options.size or 18)
    love.graphics.setFont(font)
    love.graphics.setColor(color(ui.theme, options.muted and "muted" or "text"))
    love.graphics.print(text or "", x, y)
    return font:getWidth(text or ""), font:getHeight()
end

function UI.Button(ui, label, x, y, w, h, options)
    options = options or {}
    local id = options.id or UI.id(ui, "button")
    local inside = contains(x, y, w, h, ui.mouseX, ui.mouseY)
    if inside then ui.hot = id end
    if inside and ui.mousePressed then ui.active = id end
    local clicked = inside and ui.mouseReleased and ui.active == id
    if ui.mouseReleased and ui.active == id then ui.active = nil end
    local fill = ui.active == id and "fillActive" or (inside and "fillHot" or "fill")
    local border = inside and "borderHot" or "border"
    drawRect(ui.theme, x, y, w, h, fill, border)
    local font = UI.font(ui, options.size or 20)
    love.graphics.setFont(font)
    love.graphics.setColor(color(ui.theme, options.danger and "danger" or "text"))
    local textWidth = font:getWidth(label or "")
    local textHeight = font:getHeight()
    love.graphics.print(label or "", math.floor(x + (w - textWidth) * 0.5), math.floor(y + (h - textHeight) * 0.5))
    return clicked
end

function UI.TextField(ui, value, x, y, w, h, options)
    options = options or {}
    local id = options.id or UI.id(ui, "textfield")
    local inside = contains(x, y, w, h, ui.mouseX, ui.mouseY)
    if inside and ui.mousePressed then ui.focus = id end
    if ui.mousePressed and not inside and ui.focus == id then ui.focus = nil end
    local changed = false
    local nextValue = tostring(value or "")
    if ui.focus == id then
        for _, text in ipairs(ui.text) do
            nextValue = nextValue .. text
            changed = true
        end
        if ui.keys.backspace and #nextValue > 0 then
            nextValue = nextValue:sub(1, -2)
            changed = true
        end
        if ui.keys.escape or ui.keys["return"] then ui.focus = nil end
    end
    drawRect(ui.theme, x, y, w, h, inside and "fillHot" or "fill", ui.focus == id and "borderHot" or "border")
    local font = UI.font(ui, options.size or 18)
    love.graphics.setFont(font)
    love.graphics.setColor(color(ui.theme, "text"))
    local text = nextValue
    if ui.focus == id and math.floor(love.timer.getTime() * 2) % 2 == 0 then text = text .. "_" end
    love.graphics.print(text, x + 8, math.floor(y + (h - font:getHeight()) * 0.5))
    return nextValue, changed
end

function UI.Slider(ui, value, minValue, maxValue, x, y, w, h, options)
    options = options or {}
    local id = options.id or UI.id(ui, "slider")
    local inside = contains(x, y, w, h, ui.mouseX, ui.mouseY)
    if inside and ui.mousePressed then ui.active = id end
    local dragging = ui.active == id and love.mouse.isDown(1)
    local changed = false
    local nextValue = clamp(tonumber(value) or minValue, minValue, maxValue)
    if dragging then
        local t = clamp((ui.mouseX - x) / math.max(1, w), 0, 1)
        nextValue = minValue + (maxValue - minValue) * t
        changed = true
    elseif ui.mouseReleased and ui.active == id then
        ui.active = nil
    end
    local t = (nextValue - minValue) / math.max(0.000001, maxValue - minValue)
    drawRect(ui.theme, x, y + math.floor(h * 0.35), w, math.max(6, math.floor(h * 0.3)), "fill", inside and "borderHot" or "border")
    love.graphics.setColor(color(ui.theme, "accent"))
    love.graphics.rectangle("fill", x, y + math.floor(h * 0.35), math.floor(w * t), math.max(6, math.floor(h * 0.3)))
    love.graphics.setColor(color(ui.theme, "text"))
    love.graphics.rectangle("fill", x + math.floor(w * t) - 3, y + 2, 6, h - 4)
    return nextValue, changed
end

function UI.RadioGroup(ui, value, items, x, y, w, rowH, options)
    options = options or {}
    local nextValue = value
    local changed = false
    for index, item in ipairs(items or {}) do
        local itemValue = item.value or item
        local label = item.label or tostring(item)
        local rowY = y + (index - 1) * rowH
        local id = (options.id or "radio") .. ":" .. tostring(itemValue)
        local inside = contains(x, rowY, w, rowH, ui.mouseX, ui.mouseY)
        if inside and ui.mousePressed then
            nextValue = itemValue
            changed = nextValue ~= value
        end
        drawRect(ui.theme, x, rowY, rowH - 6, rowH - 6, "fill", inside and "borderHot" or "border")
        if itemValue == nextValue then
            love.graphics.setColor(color(ui.theme, "accent"))
            love.graphics.rectangle("fill", x + 5, rowY + 5, rowH - 16, rowH - 16)
        end
        UI.Label(ui, label, x + rowH, rowY + 2, { size = options.size or 18 })
        ui.hot = inside and id or ui.hot
    end
    return nextValue, changed
end

function UI.Checkbox(ui, value, label, x, y, w, h, options)
    options = options or {}
    local id = options.id or UI.id(ui, "checkbox")
    local inside = contains(x, y, w, h, ui.mouseX, ui.mouseY)
    local nextValue = value == true
    local changed = false
    if inside and ui.mousePressed then
        nextValue = not nextValue
        changed = true
    end
    drawRect(ui.theme, x, y, h - 6, h - 6, "fill", inside and "borderHot" or "border")
    if nextValue then
        love.graphics.setColor(color(ui.theme, "accent"))
        love.graphics.rectangle("fill", x + 5, y + 5, h - 16, h - 16)
    end
    UI.Label(ui, label, x + h, y + 2, { size = options.size or 18 })
    ui.hot = inside and id or ui.hot
    return nextValue, changed
end

function UI.List(ui, id, items, x, y, w, h, options)
    options = options or {}
    local rowH = options.rowH or 30
    local scroll = ui.scroll[id] or 0
    if contains(x, y, w, h, ui.mouseX, ui.mouseY) and ui.wheelY ~= 0 then
        scroll = clamp(scroll - ui.wheelY * rowH, 0, math.max(0, #(items or {}) * rowH - h))
        ui.scroll[id] = scroll
    end
    drawRect(ui.theme, x, y, w, h, "fill", "border")
    love.graphics.setScissor(x, y, w, h)
    local selected, selectedIndex
    for index, item in ipairs(items or {}) do
        local rowY = y + (index - 1) * rowH - scroll
        if rowY + rowH >= y and rowY <= y + h then
            if UI.Button(ui, item.label or tostring(item), x + 4, rowY + 3, w - 8, rowH - 6, { id = id .. ":" .. index, size = options.size or 16 }) then
                selected, selectedIndex = item, index
            end
        end
    end
    love.graphics.setScissor()
    return selected, selectedIndex
end

return UI
