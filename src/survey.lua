local Survey = {}

local function key(...)
    local parts = {}
    for index = 1, select("#", ...) do
        parts[index] = tostring(select(index, ...))
    end
    return table.concat(parts, ":")
end

function Survey.new()
    return {
        cells = {},
        discoveries = {},
        pins = {},
        cellCount = 0,
        discoveryCount = 0,
        pinCount = 0,
        nextPinId = 1,
    }
end

function Survey.mark(history, world, x, y, scale)
    history = history or Survey.new()
    scale = scale or "local"
    local cell = world:sample(math.floor(x), math.floor(y), scale)
    local cellKey = key(scale, cell.x, cell.y)
    if not history.cells[cellKey] then
        history.cells[cellKey] = {
            x = cell.x,
            y = cell.y,
            scale = scale,
            biome = cell.biome,
            basinId = cell.basinId,
            watershedId = cell.watershedId,
            ridgeId = cell.ridgeId,
            mountainRangeId = cell.mountainRangeId,
        }
        history.cellCount = history.cellCount + 1
    end
    for _, discovery in ipairs(world:discoveriesAt(cell.x, cell.y, scale)) do
        local discoveryKey = key(discovery.kind, discovery.id)
        if not history.discoveries[discoveryKey] then
            history.discoveries[discoveryKey] = discovery
            history.discoveryCount = history.discoveryCount + 1
        end
    end
    history.lastCellKey = cellKey
    return history.cells[cellKey]
end

function Survey.dropPin(history, world, x, y, scale, label)
    history = history or Survey.new()
    scale = scale or "local"
    local cell = world and world:sample(math.floor(x), math.floor(y), scale) or { x = math.floor(x), y = math.floor(y), biome = "unknown" }
    local id = history.nextPinId or 1
    history.nextPinId = id + 1
    local pin = {
        id = id,
        x = cell.x or math.floor(x),
        y = cell.y or math.floor(y),
        scale = scale,
        label = label or ("Pin " .. tostring(id)),
        biome = cell.biome,
        koppen = cell.koppen,
    }
    local pinKey = key("pin", id)
    history.pins[pinKey] = pin
    history.pinCount = (history.pinCount or 0) + 1
    return pin
end

function Survey.deletePin(history, pinKey)
    if not (history and history.pins) then return false end
    local entryKey = type(pinKey) == "number" and key("pin", pinKey) or tostring(pinKey)
    if not history.pins[entryKey] then return false end
    history.pins[entryKey] = nil
    history.pinCount = math.max(0, (history.pinCount or 1) - 1)
    return true
end

local function sortedEntries(tableValue)
    local entries = {}
    for entryKey, value in pairs(tableValue or {}) do
        local copy = { key = entryKey }
        for k, v in pairs(value) do copy[k] = v end
        entries[#entries + 1] = copy
    end
    table.sort(entries, function(a, b) return tostring(a.key) < tostring(b.key) end)
    return entries
end

function Survey.discoveryEntries(history)
    return sortedEntries(history and history.discoveries)
end

function Survey.pinEntries(history)
    return sortedEntries(history and history.pins)
end

function Survey.snapshot(history)
    history = history or Survey.new()
    return {
        cells = sortedEntries(history.cells),
        discoveries = sortedEntries(history.discoveries),
        pins = sortedEntries(history.pins),
        nextPinId = history.nextPinId or 1,
        lastCellKey = history.lastCellKey,
    }
end

function Survey.fromSnapshot(snapshot)
    local history = Survey.new()
    for _, item in ipairs((snapshot and snapshot.cells) or {}) do
        local entryKey = item.key or key(item.scale, item.x, item.y)
        local copy = {}
        for k, v in pairs(item) do if k ~= "key" then copy[k] = v end end
        history.cells[entryKey] = copy
        history.cellCount = history.cellCount + 1
    end
    for _, item in ipairs((snapshot and snapshot.discoveries) or {}) do
        local entryKey = item.key or key(item.kind, item.id)
        local copy = {}
        for k, v in pairs(item) do if k ~= "key" then copy[k] = v end end
        history.discoveries[entryKey] = copy
        history.discoveryCount = history.discoveryCount + 1
    end
    local maxPinId = 0
    for _, item in ipairs((snapshot and snapshot.pins) or {}) do
        local entryKey = item.key or key("pin", item.id)
        local copy = {}
        for k, v in pairs(item) do if k ~= "key" then copy[k] = v end end
        history.pins[entryKey] = copy
        history.pinCount = history.pinCount + 1
        maxPinId = math.max(maxPinId, tonumber(copy.id) or 0)
    end
    history.nextPinId = math.max(tonumber(snapshot and snapshot.nextPinId) or 1, maxPinId + 1)
    history.lastCellKey = snapshot and snapshot.lastCellKey or nil
    return history
end

return Survey
