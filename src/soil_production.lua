local SoilProduction = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function option(value, fallback)
    if value == nil then return fallback end
    return value
end

function SoilProduction.steadyStateDepth(erosionRate, options)
    options = options or {}
    local p0 = option(options.p0, 1.5e-4)
    local hStar = option(options.hStar, 0.5)
    erosionRate = math.max(0, erosionRate or 0)
    if erosionRate <= 0 then return hStar end
    if erosionRate >= p0 then return 0 end
    return hStar * math.log(p0 / erosionRate)
end

function SoilProduction.syncCell(cell)
    if not cell then return nil end
    local elevation = cell.elevation or cell.elevationBase or 0
    local regolith = math.max(0, cell.regolithDepth or 0)
    cell.regolithDepth = regolith
    cell.bedrockElevation = elevation - regolith
    return cell
end

function SoilProduction.syncRegion(region)
    for _, cell in pairs(region.cells or {}) do
        SoilProduction.syncCell(cell)
    end
end

function SoilProduction.step(region, options)
    options = options or {}
    local dt = options.dt or 0
    if dt <= 0 then
        SoilProduction.syncRegion(region)
        return { produced = 0, cells = 0, maxDepth = 0 }
    end
    local p0 = option(options.p0, 1.5e-4)
    local hStar = option(options.hStar, 0.5)
    local bulk = option(options.bulkingRatio, 1.5)
    local dtYears = dt * option(options.dtYearsScale, 1000)
    local slopeScale = option(options.slopeErosionScale, 4e-4)
    local baseErosion = option(options.baseErosionRate, 4e-5)
    local produced, cells, maxDepth = 0, 0, 0
    for _, cell in pairs(region.cells or {}) do
        local elevation = cell.elevation or cell.elevationBase or 0
        local current = math.max(0, cell.regolithDepth or 0)
        local erosionRate = option(cell.soilErosionRate, baseErosion + clamp(cell.slope or 0, 0, 1) * slopeScale)
        local target = SoilProduction.steadyStateDepth(erosionRate, { p0 = p0, hStar = hStar })
        local production = p0 * math.exp(-current / hStar) * dtYears * bulk
        local nextDepth = clamp(math.min(target, current + production), 0, math.max(target, current))
        cell.regolithDepth = nextDepth
        cell.bedrockElevation = elevation - nextDepth
        produced = produced + math.max(0, nextDepth - current)
        cells = cells + 1
        if nextDepth > maxDepth then maxDepth = nextDepth end
    end
    return { produced = produced, cells = cells, maxDepth = maxDepth }
end

return SoilProduction
