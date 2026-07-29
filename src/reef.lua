local Rng = require("src.rng")

local Reef = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local neighbors = {
    { x = -1, y = 0 },
    { x = 1, y = 0 },
    { x = 0, y = -1 },
    { x = 0, y = 1 },
    { x = -1, y = -1 },
    { x = 1, y = -1 },
    { x = -1, y = 1 },
    { x = 1, y = 1 },
}

local function latitudeUnit(cell)
    return math.abs(cell.latitudeRadians or 0) / (math.pi / 2)
end

local function adjacentLand(region, cell, radius)
    local gx, gy = cell.gx or 0, cell.gy or 0
    for yy = gy - radius, gy + radius do
        for xx = gx - radius, gx + radius do
            local neighbor = region.cells[key(xx, yy)]
            if neighbor and not neighbor.water then return true end
        end
    end
    return false
end

local function localSeedCell(region, cell)
    local best = cell
    local gx, gy = cell.gx or 0, cell.gy or 0
    for yy = gy - 4, gy + 4 do
        for xx = gx - 4, gx + 4 do
            local neighbor = region.cells[key(xx, yy)]
            if neighbor and (neighbor.elevation or -1) > (best.elevation or -1) then best = neighbor end
        end
    end
    return best
end

local function candidate(cell, seaLevel)
    if not (cell and cell.water) or cell.lake then return false end
    if latitudeUnit(cell) >= 0.4 then return false end
    if (cell.temperature or 0) <= 0.62 then return false end
    return (cell.elevation or cell.elevationBase or 0) > seaLevel - 0.08
end

local function subsidence(cell, options)
    local zScale = options.zScale or 10000
    local thermal = math.max(0, ((cell.oceanDepthMeters or 2600) - 2600) / zScale)
    local hotspot = (cell.hotspotContribution or 0) * (1 - math.exp(-math.max(0, cell.hotspotAgeMy or 0) / 30)) * 0.18
    return thermal + hotspot
end

local function reefAgeMyr(seed, seedCell, geologicTimeMyr)
    if geologicTimeMyr <= 0 then return 0 end
    local start = Rng.unitAt(seed, seedCell.gx or 0, seedCell.gy or 0, 1061) * geologicTimeMyr
    return math.max(0, geologicTimeMyr - start)
end

local function stageFor(region, cell, accretion, sub, seaLevel)
    local keepsPace = accretion >= sub - 0.02
    if not keepsPace then return 5 end
    if sub < 0.005 and adjacentLand(region, cell, 1) then return 1 end
    if sub < 0.04 then return 2 end
    if adjacentLand(region, cell, 3) then return 2 end
    return (cell.elevation or 0) > seaLevel - 0.045 and 3 or 4
end

function Reef.applyRegion(region, options)
    options = options or {}
    local seed = options.seed or region.seed or 1
    local seaLevel = options.seaLevel or region.seaLevel or 0
    local geologicTimeMyr = options.geologicTimeMyr or ((options.geologicTime or region.geologicTime or 0) * 100)
    local growthRate = options.reefGrowthRate or 0.05
    local stats = { candidates = 0, fringing = 0, barrier = 0, atoll = 0, lagoon = 0, submerged = 0 }
    for _, cell in pairs(region.cells or {}) do
        cell.reefAccretion = 0
        cell.reefAgeMy = 0
        cell.reefStage = 0
        if candidate(cell, seaLevel) then
            local seedCell = localSeedCell(region, cell)
            local age = reefAgeMyr(seed, seedCell, geologicTimeMyr)
            local accretion = age * growthRate
            local sub = options.forceSubsidence or subsidence(cell, options)
            local stage = stageFor(region, cell, accretion, sub, seaLevel)
            cell.reefAgeMy = age
            cell.reefAccretion = accretion
            cell.reefStage = stage
            stats.candidates = stats.candidates + 1
            if stage == 1 then stats.fringing = stats.fringing + 1 end
            if stage == 2 then stats.barrier = stats.barrier + 1 end
            if stage == 3 then stats.atoll = stats.atoll + 1 end
            if stage == 4 then stats.lagoon = stats.lagoon + 1 end
            if stage == 5 then stats.submerged = stats.submerged + 1 end
            if stage >= 1 and stage <= 3 then
                cell.elevation = math.max(cell.elevation or cell.elevationBase or 0, seaLevel + 0.002)
            end
        end
    end
    region.reefs = stats
    return stats
end

return Reef
