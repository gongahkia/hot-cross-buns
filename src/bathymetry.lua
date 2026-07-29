local Rng = require("src.rng")

local Bathymetry = {}

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

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function elevation(cell)
    return cell and (cell.elevationBase or cell.elevation or 0) or 0
end

local function shelfCandidate(cell, seaLevel)
    return cell and cell.water and not cell.lake and (cell.shelfDistance or 999) < 30 and elevation(cell) > seaLevel - 0.14
end

local function adjacentLand(region, cell)
    for _, offset in ipairs(neighbors) do
        local neighbor = region.cells[key((cell.gx or 0) + offset.x, (cell.gy or 0) + offset.y)]
        if neighbor and not neighbor.water then return true end
    end
    return false
end

local function steepestOcean(region, cell)
    local best, bestDrop
    local current = elevation(cell)
    for _, offset in ipairs(neighbors) do
        local nextCell = region.cells[key((cell.gx or 0) + offset.x, (cell.gy or 0) + offset.y)]
        if nextCell and nextCell.water and not nextCell.lake then
            local drop = (current - elevation(nextCell)) / offset.distance
            if drop > (bestDrop or 0) then
                best = nextCell
                bestDrop = drop
            end
        end
    end
    return best
end

local function incise(cell, amount)
    cell.elevationBase = (cell.elevationBase or cell.elevation or 0) - amount
    cell.elevation = (cell.elevation or cell.elevationBase or 0) - amount
    cell.bedrockElevation = (cell.bedrockElevation or cell.elevationBase or 0) - amount
    cell.submarineCanyon = true
end

function Bathymetry.applyRegion(region, options)
    options = options or {}
    local seed = options.seed or region.seed or 1
    local seaLevel = options.seaLevel or region.seaLevel or 0
    local stats = { candidates = 0, canyons = 0, canyonCells = 0, maxIncision = 0 }
    for _, cell in pairs(region.cells or {}) do cell.submarineCanyon = false end
    local candidates = {}
    for _, cell in pairs(region.cells or {}) do
        if shelfCandidate(cell, seaLevel) and (adjacentLand(region, cell) or (cell.flow or 0) > (region.threshold or 64) * 0.2) and Rng.unitAt(seed, cell.gx or 0, cell.gy or 0, 1401) < (options.canyonDensity or 0.08) then
            candidates[#candidates + 1] = cell
        end
    end
    table.sort(candidates, function(a, b)
        local ah = Rng.hash(seed, a.gx or 0, a.gy or 0, 1405)
        local bh = Rng.hash(seed, b.gx or 0, b.gy or 0, 1405)
        if ah == bh then
            if (a.gy or 0) == (b.gy or 0) then return (a.gx or 0) < (b.gx or 0) end
            return (a.gy or 0) < (b.gy or 0)
        end
        return ah < bh
    end)
    stats.candidates = #candidates
    for _, cell in ipairs(candidates) do
        local steps = 8 + math.floor(Rng.unitAt(seed, cell.gx or 0, cell.gy or 0, 1403) * 9)
        local current = cell
        local cells = 0
        for step = 1, steps do
            local amount = 0.015 * (1 - (step - 1) / steps)
            incise(current, amount)
            stats.maxIncision = math.max(stats.maxIncision, amount)
            stats.canyonCells = stats.canyonCells + 1
            cells = cells + 1
            local nextCell = steepestOcean(region, current)
            if not nextCell then break end
            current = nextCell
        end
        if cells > 0 then stats.canyons = stats.canyons + 1 end
    end
    region.bathymetry = stats
    return stats
end

return Bathymetry
