local Rng = require("src.rng")

local Periglacial = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function coldCandidate(cell)
    return cell and not cell.water and not cell.glaciated and (cell.temperature or 1) < 0.25
end

local function addElevation(cell, delta)
    local base = cell.elevationBase or cell.elevation or 0
    local elevation = cell.elevation or base
    local bedrock = cell.bedrockElevation or base
    cell.elevationBase = base + delta
    cell.elevation = elevation + delta
    cell.bedrockElevation = bedrock + delta
end

local function setFeature(cell, feature)
    if cell then cell.periglacialFeature = math.max(cell.periglacialFeature or 0, feature) end
end

local function stampMound(region, center, feature, height)
    local gx0, gy0 = center.gx or 0, center.gy or 0
    local affected = 0
    for gy = gy0 - 1, gy0 + 1 do
        for gx = gx0 - 1, gx0 + 1 do
            local cell = region.cells[key(gx, gy)]
            if coldCandidate(cell) then
                local dist = math.sqrt((gx - gx0) * (gx - gx0) + (gy - gy0) * (gy - gy0))
                if dist <= 1.5 then
                    local delta = height * math.max(0, 1 - dist / 1.5)
                    addElevation(cell, delta)
                    cell.slope = clamp((cell.slope or 0) + delta * 1.5, 0, 1)
                    setFeature(cell, feature)
                    affected = affected + 1
                end
            end
        end
    end
    return affected
end

local function polygonal(cell, seed)
    local gx, gy = cell.gx or 0, cell.gy or 0
    local cellX, cellY = math.floor(gx / 3), math.floor(gy / 3)
    local edge = math.abs((gx % 3) - 1) + math.abs((gy % 3) - 1)
    return edge >= 1 and Rng.unitAt(seed, cellX, cellY, 1301) < 0.72
end

function Periglacial.applyRegion(region, options)
    options = options or {}
    local seed = options.seed or region.seed or 1
    local pingoDensity = options.pingoDensity or 0.05
    local palsaDensity = options.palsaDensity or 0.04
    local stats = { coldCells = 0, pingos = 0, palsas = 0, polygons = 0, solifluction = 0, affectedCells = 0 }
    for _, cell in pairs(region.cells or {}) do
        cell.periglacialFeature = 0
    end
    for _, cell in pairs(region.cells or {}) do
        if coldCandidate(cell) then
            stats.coldCells = stats.coldCells + 1
            local gx, gy = cell.gx or 0, cell.gy or 0
            local slope = cell.slope or 0
            local moisture = cell.moisture or cell.rainfall or 0
            if slope < 0.08 and (cell.biome == "tundra" or (cell.temperature or 1) < 0.18) and Rng.unitAt(seed, gx, gy, 1303) < pingoDensity then
                local affected = stampMound(region, cell, 1, 0.005 + Rng.unitAt(seed, gx, gy, 1305) * 0.01)
                if affected > 0 then
                    stats.pingos = stats.pingos + 1
                    stats.affectedCells = stats.affectedCells + affected
                end
            elseif slope < 0.06 and moisture > 0.45 and Rng.unitAt(seed, gx, gy, 1307) < palsaDensity then
                local affected = stampMound(region, cell, 2, 0.003 + Rng.unitAt(seed, gx, gy, 1309) * 0.004)
                if affected > 0 then
                    stats.palsas = stats.palsas + 1
                    stats.affectedCells = stats.affectedCells + affected
                end
            elseif polygonal(cell, seed) and slope < 0.1 then
                setFeature(cell, 3)
                stats.polygons = stats.polygons + 1
            elseif slope >= 0.05 and slope <= 0.2 then
                local ridge = (Rng.unitAt(seed, math.floor(gx / 2), math.floor(gy / 2), 1311) * 2 - 1) * 0.003
                addElevation(cell, ridge)
                setFeature(cell, 4)
                stats.solifluction = stats.solifluction + 1
                stats.affectedCells = stats.affectedCells + 1
            end
        end
    end
    region.periglacial = stats
    return stats
end

return Periglacial
