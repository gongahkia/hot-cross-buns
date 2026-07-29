local Hillslope = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function option(value, fallback)
    if value == nil then return fallback end
    return value
end

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function surface(cell)
    return cell.elevation or cell.elevationBase or 0
end

local function orderedCells(region)
    local cells = {}
    for _, cell in pairs(region.cells or {}) do cells[#cells + 1] = cell end
    table.sort(cells, function(a, b)
        if (a.gy or 0) == (b.gy or 0) then return (a.gx or 0) < (b.gx or 0) end
        return (a.gy or 0) < (b.gy or 0)
    end)
    return cells
end

local function syncSurface(cell)
    local regolith = math.max(0, cell.regolithDepth or 0)
    cell.regolithDepth = regolith
    cell.bedrockElevation = cell.bedrockElevation or (surface(cell) - regolith)
    cell.elevation = cell.bedrockElevation + regolith
end

local function faceParams(a, b, options)
    local baseD = option(options.D, 0.005)
    local aD = (a.regolithDepth or 0) > 0 and baseD or baseD * 0.1
    local bD = (b.regolithDepth or 0) > 0 and baseD or baseD * 0.1
    local d = (aD + bD) * 0.5
    local sc = option(options.Sc, 1.2)
    if a.lithology == 7 or b.lithology == 7 then sc = math.min(sc, 0.8) end
    return d, sc
end

function Hillslope.faceFlux(slope, d, sc)
    local ratio = clamp(math.abs(slope) / math.max(0.000001, sc), 0, 0.99)
    return -d * slope / math.max(0.000001, 1 - ratio * ratio), ratio
end

local function transferFace(a, b, distance, options, dtYears, result)
    local slope = (surface(b) - surface(a)) / distance
    local d, sc = faceParams(a, b, options)
    local flux, ratio = Hillslope.faceFlux(slope, d, sc)
    local amount = math.abs(flux) * dtYears / distance
    if amount <= 0 then return end
    local source, dest = a, b
    if flux < 0 then source, dest = b, a end
    amount = math.min(amount, math.max(0, source.regolithDepth or 0))
    if amount <= 0 then return end
    source.regolithDepth = (source.regolithDepth or 0) - amount
    dest.regolithDepth = (dest.regolithDepth or 0) + amount
    source.hillslopeDelta = (source.hillslopeDelta or 0) - amount
    dest.hillslopeDelta = (dest.hillslopeDelta or 0) + amount
    result.moved = result.moved + amount
    if ratio > result.maxSlopeRatio then result.maxSlopeRatio = ratio end
    if ratio >= 0.54 and ratio <= 0.66 then result.transitionFaces = result.transitionFaces + 1 end
end

local function recomputeStreamPowerSlope(region)
    for _, cell in ipairs(orderedCells(region)) do
        if cell.downCell then
            local distance = math.max(1, cell.downDistance or region.stride or 1)
            cell.streamPowerSlope = math.max(0, (surface(cell) - surface(cell.downCell)) / distance)
        else
            cell.streamPowerSlope = 0
        end
    end
end

function Hillslope.diffuse(region, options)
    options = options or {}
    local dt = options.dt or 0
    local iterations = math.max(0, math.floor(option(options.iterations, 1)))
    local result = { moved = 0, cells = 0, maxSlopeRatio = 0, transitionFaces = 0 }
    local cells = orderedCells(region)
    for _, cell in ipairs(cells) do
        cell.hillslopeDelta = 0
        syncSurface(cell)
        result.cells = result.cells + 1
    end
    if dt <= 0 or iterations <= 0 then
        recomputeStreamPowerSlope(region)
        region.hillslope = result
        return result
    end
    local dtYears = dt * option(options.dtYearsScale, 1000)
    for _ = 1, iterations do
        for _, cell in ipairs(cells) do
            local east = region.cells[key((cell.gx or 0) + 1, cell.gy or 0)]
            local south = region.cells[key(cell.gx or 0, (cell.gy or 0) + 1)]
            if east then transferFace(cell, east, math.max(1, region.stride or 1), options, dtYears, result) end
            if south then transferFace(cell, south, math.max(1, region.stride or 1), options, dtYears, result) end
        end
        for _, cell in ipairs(cells) do
            syncSurface(cell)
        end
    end
    recomputeStreamPowerSlope(region)
    region.hillslope = result
    return result
end

return Hillslope
