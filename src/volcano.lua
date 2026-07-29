local Rng = require("src.rng")

local Volcano = {}

local neighbors = {
    { x = -1, y = -1, distance = 1.41421356237 },
    { x = 0, y = -1, distance = 1 },
    { x = 1, y = -1, distance = 1.41421356237 },
    { x = -1, y = 0, distance = 1 },
    { x = 1, y = 0, distance = 1 },
    { x = -1, y = 1, distance = 1.41421356237 },
    { x = 0, y = 1, distance = 1 },
    { x = 1, y = 1, distance = 1.41421356237 },
}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function cellElevation(cell)
    return cell and (cell.elevationBase or cell.elevation or 0) or 0
end

local function intensity(cell, options)
    local arc = clamp(((cell.volcanicIslandArc or 0) - options.arcThreshold) / math.max(0.001, 0.12 - options.arcThreshold), 0, 1)
    local hotspot = clamp(((cell.hotspotContribution or 0) - options.hotspotThreshold) / math.max(0.001, 0.45 - options.hotspotThreshold), 0, 1)
    return math.max(arc, hotspot), arc, hotspot
end

local function localMaximum(region, cell, options)
    local current = intensity(cell, options)
    for _, offset in ipairs(neighbors) do
        local neighbor = region.cells[key((cell.gx or 0) + offset.x, (cell.gy or 0) + offset.y)]
        if neighbor and intensity(neighbor, options) > current then return false end
    end
    return true
end

local function kindFor(cell, arc, hotspot, options)
    if options.forceKind then return options.forceKind end
    if hotspot >= arc and (cell.lithology == 1 or cell.isFloodBasalt or (cell.hotspotContribution or 0) > options.hotspotThreshold) then return 4 end
    if arc > 0 then return 1 end
    return 5
end

local function setForm(cell, form, age)
    if not cell then return end
    if form == 3 then
        local current = cell.volcanicForm or 0
        if current == 0 or current == 4 or current == 5 then cell.volcanicForm = 3 end
    else
        cell.volcanicForm = form
    end
    cell.volcanicAgeMy = math.max(cell.volcanicAgeMy or 0, age or 0)
end

local function addElevation(cell, delta)
    local base = cell.elevationBase or cell.elevation or 0
    local elevation = cell.elevation or base
    local bedrock = cell.bedrockElevation or base
    cell.elevationBase = base + delta
    cell.elevation = elevation + delta
    cell.bedrockElevation = bedrock + delta
end

local function stampCone(region, center, kind, seed, stats)
    local gx0, gy0 = center.gx or 0, center.gy or 0
    local u = Rng.unitAt(seed, gx0, gy0, 1201)
    local hPeak, rScale
    if kind == 4 then
        hPeak = 0.08 + u * 0.06
        rScale = 5 + Rng.unitAt(seed, gx0, gy0, 1203) * 3
    elseif kind == 5 then
        hPeak = 0.04
        rScale = 1.5
    else
        hPeak = 0.18 + u * 0.14
        rScale = 2 + Rng.unitAt(seed, gx0, gy0, 1203) * 2
    end
    local radius = math.ceil(rScale * 3)
    local affected, maxDelta = 0, 0
    for gy = gy0 - radius, gy0 + radius do
        for gx = gx0 - radius, gx0 + radius do
            local cell = region.cells[key(gx, gy)]
            if cell and not cell.water then
                local dx, dy = gx - gx0, gy - gy0
                local dist = math.sqrt(dx * dx + dy * dy)
                if dist <= radius then
                    local delta = hPeak * math.exp(-dist / rScale)
                    addElevation(cell, delta)
                    cell.slope = clamp((cell.slope or 0) + delta * (kind == 4 and 0.18 or 0.38), 0, 1)
                    setForm(cell, kind, center.volcanicAgeMy)
                    affected = affected + 1
                    maxDelta = math.max(maxDelta, delta)
                end
            end
        end
    end
    stats.affectedCells = stats.affectedCells + affected
    stats.maxDelta = math.max(stats.maxDelta, maxDelta)
    return radius
end

local function stampCaldera(region, center, radius, stats)
    local gx0, gy0 = center.gx or 0, center.gy or 0
    local calderaRadius = math.max(1, math.floor(radius * 0.38))
    local cells = 0
    for gy = gy0 - calderaRadius, gy0 + calderaRadius do
        for gx = gx0 - calderaRadius, gx0 + calderaRadius do
            local cell = region.cells[key(gx, gy)]
            if cell and not cell.water then
                local dx, dy = gx - gx0, gy - gy0
                local dist = math.sqrt(dx * dx + dy * dy)
                if dist <= calderaRadius then
                    local delta = -0.14 * (1 + math.cos(dist * math.pi / calderaRadius)) * 0.5
                    addElevation(cell, delta)
                    setForm(cell, 2, center.volcanicAgeMy)
                    cell.slope = clamp((cell.slope or 0) + math.abs(delta) * 0.15, 0, 1)
                    cells = cells + 1
                end
            end
        end
    end
    if cells > 0 then stats.calderas = stats.calderas + 1 end
end

local function steepestDown(region, cell)
    local best, bestDrop
    local elevation = cellElevation(cell)
    for _, offset in ipairs(neighbors) do
        local nextCell = region.cells[key((cell.gx or 0) + offset.x, (cell.gy or 0) + offset.y)]
        if nextCell and not nextCell.water then
            local drop = (elevation - cellElevation(nextCell)) / offset.distance
            if drop > (bestDrop or 0) then
                best = nextCell
                bestDrop = drop
            end
        end
    end
    return best
end

local function stampFlow(region, center, seed, stats)
    local steps = 8 + math.floor(Rng.unitAt(seed, center.gx or 0, center.gy or 0, 1211) * 9)
    local cell = center
    local flowCells = 0
    for step = 1, steps do
        local nextCell = steepestDown(region, cell)
        if not nextCell then break end
        local thickness = 0.01 * (1 - (step - 1) / steps)
        addElevation(nextCell, thickness)
        setForm(nextCell, 3, center.volcanicAgeMy)
        flowCells = flowCells + 1
        cell = nextCell
    end
    if flowCells > 0 then
        stats.lavaFlows = stats.lavaFlows + 1
        stats.lavaFlowCells = stats.lavaFlowCells + flowCells
    end
end

local function stampCinderField(region, center, seed, stats)
    local count = 5 + math.floor(Rng.unitAt(seed, center.gx or 0, center.gy or 0, 1221) * 6)
    for index = 1, count do
        local angle = Rng.unitAt(seed, center.gx or 0, center.gy or 0, 1223 + index) * math.pi * 2
        local radius = 2 + Rng.unitAt(seed, center.gx or 0, center.gy or 0, 1241 + index) * 5
        local gx = math.floor((center.gx or 0) + math.cos(angle) * radius + 0.5)
        local gy = math.floor((center.gy or 0) + math.sin(angle) * radius + 0.5)
        local cell = region.cells[key(gx, gy)]
        if cell and not cell.water then
            cell.volcanicAgeMy = center.volcanicAgeMy
            stampCone(region, cell, 5, seed + index * 17, stats)
            stats.cinderCones = stats.cinderCones + 1
        end
    end
end

local function pruneCandidates(candidates, minDistance)
    local kept, minDistance2 = {}, minDistance * minDistance
    for _, candidate in ipairs(candidates) do
        local ok = true
        for _, other in ipairs(kept) do
            local dx = (candidate.gx or 0) - (other.gx or 0)
            local dy = (candidate.gy or 0) - (other.gy or 0)
            if dx * dx + dy * dy < minDistance2 then
                ok = false
                break
            end
        end
        if ok then kept[#kept + 1] = candidate end
    end
    return kept
end

function Volcano.applyRegion(region, options)
    options = options or {}
    options.arcThreshold = options.arcThreshold or 0.04
    options.hotspotThreshold = options.hotspotThreshold or 0.25
    local seed = options.seed or region.seed or 1
    local candidates = {}
    for _, cell in pairs(region.cells or {}) do
        cell.volcanicForm = 0
        cell.volcanicAgeMy = 0
        local score = intensity(cell, options)
        if score > 0 and not cell.water and localMaximum(region, cell, options) then
            candidates[#candidates + 1] = cell
        end
    end
    table.sort(candidates, function(a, b)
        local ah = Rng.hash(seed, a.gx or 0, a.gy or 0, 1229)
        local bh = Rng.hash(seed, b.gx or 0, b.gy or 0, 1229)
        if ah == bh then
            if (a.gy or 0) == (b.gy or 0) then return (a.gx or 0) < (b.gx or 0) end
            return (a.gy or 0) < (b.gy or 0)
        end
        return ah < bh
    end)
    candidates = pruneCandidates(candidates, options.minSpacing or 8)
    local stats = { candidates = #candidates, stratoCones = 0, calderas = 0, lavaFlows = 0, lavaFlowCells = 0, shields = 0, cinderCones = 0, affectedCells = 0, maxDelta = 0 }
    local maxFeatures = options.maxFeatures or math.max(1, math.floor(#candidates * (options.density or 0.35)))
    for index = 1, math.min(#candidates, maxFeatures) do
        local center = candidates[index]
        local _, arc, hotspot = intensity(center, options)
        local age = (center.hotspotAgeMy or 0) + Rng.unitAt(seed, center.gx or 0, center.gy or 0, 1231) * (hotspot > arc and 60 or 6)
        center.volcanicAgeMy = age
        local kind = kindFor(center, arc, hotspot, options)
        local radius = stampCone(region, center, kind, seed, stats)
        if kind == 1 then stats.stratoCones = stats.stratoCones + 1 end
        if kind == 4 then stats.shields = stats.shields + 1 end
        if kind == 5 then stats.cinderCones = stats.cinderCones + 1 end
        if kind == 1 and (options.forceCaldera or Rng.unitAt(seed, center.gx or 0, center.gy or 0, 1237) < 0.3) then stampCaldera(region, center, radius, stats) end
        stampFlow(region, center, seed, stats)
        if kind == 4 and Rng.unitAt(seed, center.gx or 0, center.gy or 0, 1239) < 0.45 then stampCinderField(region, center, seed, stats) end
    end
    region.volcanoes = stats
    return stats
end

return Volcano
