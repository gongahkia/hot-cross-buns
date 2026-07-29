local ViewScale = {}

local function clamp(value, minValue, maxValue)
    return math.max(minValue, math.min(maxValue, value))
end

local function mix(a, b, t)
    return a + (b - a) * t
end

local function ease(t)
    return t * t * (3 - 2 * t)
end

local function scaleInfo(world, scaleId)
    local metadata = world and world:metadata() or {}
    for _, scale in ipairs(metadata.scales or {}) do
        if scale.id == scaleId then return scale end
    end
    return { id = "local", factor = 1, label = "local" }
end

local function fixedScope(world)
    local metadata = world and world:metadata() or {}
    return scaleInfo(world, metadata.scope or "local").id
end

local function labelKey(scaleId, item)
    return table.concat({ scaleId, item.kind, tostring(item.id) }, ":")
end

local function labelSampleKey(info, x, y)
    local span = math.max(8, 32 * (info.factor or 1))
    return table.concat({ info.id, math.floor(x / span), math.floor(y / span) }, ":")
end

local anchorRanks = {
    mountain_range = 1,
    ridge = 2,
    pass = 3,
    watershed = 4,
    basin = 5,
    coast = 6,
    rain_shadow = 7,
}

function ViewScale.labelPriority(kind)
    return anchorRanks[kind] or 99
end

local routes = {
    ["local"] = { target = "region", mode = "outlook" },
    region = { target = "continent", mode = "horizon" },
    continent = { target = "local", mode = "return" },
}

local function terrainAnchor(world, x, y, scaleId)
    local best
    local bestRank = 999
    for _, item in ipairs(world:discoveriesAt(x, y, scaleId)) do
        local rank = anchorRanks[item.kind] or 99
        if rank < bestRank then
            best = item
            bestRank = rank
        end
    end
    if best then return best end
    local cell = world:sample(math.floor(x), math.floor(y), scaleId)
    return {
        kind = "terrain",
        id = table.concat({ scaleId, cell.x, cell.y }, ":"),
        name = tostring(cell.biome) .. " field",
        x = cell.x,
        y = cell.y,
    }
end

function ViewScale.new(world)
    local initial = fixedScope(world)
    return {
        from = initial,
        target = initial,
        current = initial,
        progress = 1,
        duration = 0.55,
        labels = {},
        labelOrder = {},
        labelSampleKeys = {},
        anchor = nil,
    }
end

function ViewScale.activeScale(view)
    return (view and view.target) or "local"
end

function ViewScale.collectLabels(view, world, x, y, scaleId, force)
    if not (view and world) then return 0 end
    local info = scaleInfo(world, scaleId or view.target)
    local sampleKey = labelSampleKey(info, x, y)
    if not force and view.labelSampleKeys[info.id] == sampleKey then return 0 end
    view.labelSampleKeys[info.id] = sampleKey
    local added = 0
    for _, item in ipairs(world:discoveriesAt(x, y, info.id)) do
        local key = labelKey(info.id, item)
        if not view.labels[key] then
            view.labels[key] = {
                scale = info.id,
                scaleLabel = info.label,
                kind = item.kind,
                id = item.id,
                name = item.name,
                x = item.x,
                y = item.y,
                priority = ViewScale.labelPriority(item.kind),
                seen = 0,
            }
            view.labelOrder[#view.labelOrder + 1] = key
            added = added + 1
        end
        local label = view.labels[key]
        label.lastX = x
        label.lastY = y
        label.seen = (label.seen or 0) + 1
    end
    return added
end

function ViewScale.params(view, world)
    local fromInfo = scaleInfo(world, view and view.from or "local")
    local targetInfo = scaleInfo(world, view and view.target or "local")
    local progress = clamp(view and view.progress or 1, 0, 1)
    local t = ease(progress)
    return {
        from = fromInfo.id,
        target = targetInfo.id,
        scale = targetInfo.id,
        label = targetInfo.label,
        fromFactor = fromInfo.factor,
        targetFactor = targetInfo.factor,
        factor = mix(fromInfo.factor, targetInfo.factor, t),
        progress = progress,
        ease = t,
        transitioning = progress < 1,
    }
end

function ViewScale.set(view, world, scaleId, x, y)
    if not view then return "local" end
    local target = fixedScope(world)
    view.from = target
    view.target = target
    view.current = target
    view.progress = 1
    ViewScale.collectLabels(view, world, x or 0, y or 0, view.target, true)
    return target
end

function ViewScale.shift(view, world, delta, x, y)
    return ViewScale.set(view, world, nil, x, y)
end

function ViewScale.diegeticAnchor(view, world, x, y)
    local current = fixedScope(world)
    local anchor = terrainAnchor(world, x or 0, y or 0, current)
    return {
        from = current,
        target = current,
        mode = "fixed",
        kind = anchor.kind,
        id = anchor.id,
        name = anchor.name,
        x = anchor.x,
        y = anchor.y,
    }
end

function ViewScale.advanceDiegetic(view, world, x, y)
    local anchor = ViewScale.diegeticAnchor(view, world, x or 0, y or 0)
    ViewScale.collectLabels(view, world, x or 0, y or 0, anchor.from, true)
    ViewScale.set(view, world, nil, x or 0, y or 0)
    view.anchor = anchor
    return anchor
end

function ViewScale.update(view, dt, world, x, y)
    if not view then return end
    ViewScale.collectLabels(view, world, x or 0, y or 0, view.from)
    ViewScale.collectLabels(view, world, x or 0, y or 0, view.target)
    if (view.progress or 1) < 1 then
        view.progress = math.min(1, view.progress + (dt or 0) / (view.duration or 0.55))
        if view.progress >= 1 then
            view.current = view.target
            view.from = view.target
        end
    end
end

function ViewScale.preloadScales(view)
    local result = {}
    local seen = {}
    local function add(scaleId)
        scaleId = scaleId or "local"
        if seen[scaleId] then return end
        seen[scaleId] = true
        result[#result + 1] = scaleId
    end
    add(view and view.target)
    return result
end

function ViewScale.visibleLabels(view, limit)
    local result = {}
    if not view then return result end
    for index = #view.labelOrder, 1, -1 do
        local label = view.labels[view.labelOrder[index]]
        if label then
            result[#result + 1] = label
            if limit and #result >= limit then break end
        end
    end
    return result
end

return ViewScale
