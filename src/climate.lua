local Noise = require("src.noise")

local Climate = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function key(...)
    local parts = {}
    for index = 1, select("#", ...) do
        parts[index] = tostring(select(index, ...))
    end
    return table.concat(parts, ":")
end

local function latitudeFor(seed, y)
    return 0.5 + 0.5 * math.sin(y * 0.00045 + seed * 0.0001)
end

local function latitudeRadiansFor(worldOrSeed, y)
    if type(worldOrSeed) == "table" and worldOrSeed.latitudeAt then return worldOrSeed:latitudeAt(y) end
    if type(worldOrSeed) == "table" then return (latitudeFor(worldOrSeed.seed or 1, y or 0) * 2 - 1) * (math.pi / 2) end
    return (latitudeFor(worldOrSeed or 1, y or 0) * 2 - 1) * (math.pi / 2)
end

local function normalize(x, y)
    local length = math.sqrt(x * x + y * y)
    if length <= 0 then return 1, 0 end
    return x / length, y / length
end

local function rotate(x, y, angle)
    local c, s = math.cos(angle), math.sin(angle)
    return x * c - y * s, x * s + y * c
end

local function seasonPhase(world)
    local rate = math.max(0.000001, world and world.seasonRate or 1)
    return math.sin(2 * math.pi * ((world and world.geologicTime or 0) / rate))
end

local function bandForLatitude(world, latitudeRadians)
    local absLat = math.abs(latitudeRadians)
    local sign = latitudeRadians >= 0 and 1 or -1
    local itcz = (world and world.itczOffsetAmp or 0.17) * seasonPhase(world)
    local distanceToItcz = math.abs(latitudeRadians - itcz)
    local deg10, deg20, deg35, deg50, deg60 = math.rad(10), math.rad(20), math.rad(35), math.rad(50), math.rad(60)
    local zonalU, meridionalV, baselinePrecip, pressureCellId
    if distanceToItcz < deg10 then
        zonalU = -0.35
        meridionalV = latitudeRadians > itcz and -0.55 or 0.55
        baselinePrecip = 0.62
        pressureCellId = 3
    elseif absLat < deg20 then
        zonalU = -0.82
        meridionalV = latitudeRadians > itcz and -0.32 or 0.32
        baselinePrecip = 0.50
        pressureCellId = 0
    elseif absLat < deg35 then
        zonalU = -0.92
        meridionalV = 0.08 * sign
        baselinePrecip = 0.12
        pressureCellId = 1
    elseif absLat < deg50 then
        zonalU = 0.90
        meridionalV = 0.12 * sign
        baselinePrecip = 0.42
        pressureCellId = 2
    elseif absLat < deg60 then
        zonalU = 0.72
        meridionalV = -0.18 * sign
        baselinePrecip = 0.52
        pressureCellId = 5
    else
        zonalU = -0.72
        meridionalV = -0.10 * sign
        baselinePrecip = 0.18
        pressureCellId = 6
    end
    local coriolis = math.sin(latitudeRadians) * (world and world.windCoriolisScale or 0.22)
    local windX, windY = rotate(zonalU, meridionalV, math.atan(coriolis))
    windX, windY = normalize(windX, windY)
    return {
        latitudeRadians = latitudeRadians,
        windX = windX,
        windY = windY,
        baselinePrecip = baselinePrecip,
        pressureCellId = pressureCellId,
    }
end

function Climate.buildBands(world)
    local bands = {}
    for index = 1, 181 do
        local latitudeRadians = -math.pi / 2 + (index - 1) * math.pi / 180
        bands[index] = bandForLatitude(world or {}, latitudeRadians)
    end
    return bands
end

function Climate.bandForLatitude(world, latitudeRadians)
    return bandForLatitude(world or {}, latitudeRadians or 0)
end

function Climate.bandAt(worldOrSeed, y)
    local latitudeRadians = latitudeRadiansFor(worldOrSeed or 1, y or 0)
    local world = type(worldOrSeed) == "table" and worldOrSeed or nil
    if world and world.climateBands then
        local index = math.floor((latitudeRadians + math.pi / 2) / math.pi * 180 + 1.5)
        index = clamp(index, 1, #world.climateBands)
        return world.climateBands[index]
    end
    return bandForLatitude(world or { seed = worldOrSeed or 1 }, latitudeRadians)
end

function Climate.windAt(seed, y)
    local band = Climate.bandAt(seed or 1, y or 0)
    return band.windX, band.windY
end

local function climateKey(scale, gx, gy)
    return key(scale, gx, gy)
end

local function sampleAt(store, scale, gx, gy)
    local sample = store[climateKey(scale, gx, gy)]
    if not sample then return nil end
    return sample.precipitation or 0, sample.rainShadow or 0, sample.windX or 0, sample.windY or 0, sample.baselinePrecip or 0, sample.pressureCellId or 0, sample.monsoonIndex or 0
end

function Climate.sample(world, info, x, y)
    if (world.climateSampleDepth or 0) > 0 then return nil end
    local store = world.climateSamples
    if not store then return nil end
    local stride = math.max(1, world.hydrologyBasinStride or 1)
    if stride <= 1 then return nil end
    local scaleX = x / info.factor
    local scaleY = y / info.factor
    local bx = (scaleX - (stride - 1) * 0.5) / stride
    local by = (scaleY - (stride - 1) * 0.5) / stride
    local ix = math.floor(bx)
    local iy = math.floor(by)
    local tx = bx - ix
    local ty = by - iy
    local p00, r00, wx00, wy00, b00, c00, m00 = sampleAt(store, info.id, ix, iy)
    local p10, r10, wx10, wy10, b10, c10, m10 = sampleAt(store, info.id, ix + 1, iy)
    local p01, r01, wx01, wy01, b01, c01, m01 = sampleAt(store, info.id, ix, iy + 1)
    local p11, r11, wx11, wy11, b11, c11, m11 = sampleAt(store, info.id, ix + 1, iy + 1)
    if p00 and p10 and p01 and p11 then
        local px0 = p00 + (p10 - p00) * tx
        local px1 = p01 + (p11 - p01) * tx
        local rx0 = r00 + (r10 - r00) * tx
        local rx1 = r01 + (r11 - r01) * tx
        local wx0 = wx00 + (wx10 - wx00) * tx
        local wx1 = wx01 + (wx11 - wx01) * tx
        local wy0 = wy00 + (wy10 - wy00) * tx
        local wy1 = wy01 + (wy11 - wy01) * tx
        local bx0 = b00 + (b10 - b00) * tx
        local bx1 = b01 + (b11 - b01) * tx
        local mx0 = m00 + (m10 - m00) * tx
        local mx1 = m01 + (m11 - m01) * tx
        local pressureCellId = c00
        if tx >= 0.5 and ty < 0.5 then pressureCellId = c10
        elseif tx < 0.5 and ty >= 0.5 then pressureCellId = c01
        elseif tx >= 0.5 and ty >= 0.5 then pressureCellId = c11 end
        return {
            precipitation = px0 + (px1 - px0) * ty,
            rainShadow = rx0 + (rx1 - rx0) * ty,
            windX = wx0 + (wx1 - wx0) * ty,
            windY = wy0 + (wy1 - wy0) * ty,
            baselinePrecip = bx0 + (bx1 - bx0) * ty,
            pressureCellId = pressureCellId,
            monsoonIndex = mx0 + (mx1 - mx0) * ty,
        }
    end
    local precipitation, rainShadow, windX, windY, baselinePrecip, pressureCellId, monsoonIndex = sampleAt(store, info.id, math.floor(bx + 0.5), math.floor(by + 0.5))
    if not precipitation then return nil end
    return { precipitation = precipitation, rainShadow = rainShadow, windX = windX, windY = windY, baselinePrecip = baselinePrecip, pressureCellId = pressureCellId, monsoonIndex = monsoonIndex }
end

local function cellAt(region, gx, gy)
    return region.cells[key(gx, gy)]
end

local function gradient(region, cell)
    local west = cellAt(region, cell.gx - 1, cell.gy)
    local east = cellAt(region, cell.gx + 1, cell.gy)
    local north = cellAt(region, cell.gx, cell.gy - 1)
    local south = cellAt(region, cell.gx, cell.gy + 1)
    local dx = ((east and east.elevationBase or cell.elevationBase) - (west and west.elevationBase or cell.elevationBase)) * 0.5
    local dy = ((south and south.elevationBase or cell.elevationBase) - (north and north.elevationBase or cell.elevationBase)) * 0.5
    local distance = math.max(1, (region.stride or 1) * (region.scaleFactor or 1))
    return dx / distance, dy / distance
end

local function rowLandFractions(region)
    local rows = {}
    for _, cell in pairs(region.cells or {}) do
        local gy = cell.gy or 0
        local row = rows[gy]
        if not row then
            row = { land = 0, total = 0 }
            rows[gy] = row
        end
        row.total = row.total + 1
        if not cell.water then row.land = row.land + 1 end
    end
    local fractions = {}
    for gy, row in pairs(rows) do
        fractions[gy] = row.land / math.max(1, row.total)
    end
    return fractions
end

function Climate.solveRegion(world, region)
    local cells = {}
    local landFractions = rowLandFractions(region)
    local seasonal = seasonPhase(world)
    local bandByCell, sortKey = {}, {}
    local bandByY = {}
    for _, cell in pairs(region.cells or {}) do
        cells[#cells + 1] = cell
        local yKey = cell.y or cell.gy or 0
        local band = bandByY[yKey]
        if not band then
            band = Climate.bandAt(world, yKey)
            bandByY[yKey] = band
        end
        bandByCell[cell] = band
        sortKey[cell] = (cell.gx or 0) * band.windX + (cell.gy or 0) * band.windY
        cell.incomingMoisture = 0
        cell.incomingMoistureCount = 0
    end
    table.sort(cells, function(a, b)
        local ap = sortKey[a] or 0
        local bp = sortKey[b] or 0
        if ap == bp then
            if (a.gy or 0) == (b.gy or 0) then return (a.gx or 0) < (b.gx or 0) end
            return (a.gy or 0) < (b.gy or 0)
        end
        return ap < bp
    end)

    local maxPrecipitation, shadowCells = 0, 0
    local store = world.climateSamples
    for _, cell in ipairs(cells) do
        local band = bandByCell[cell]
        local windX, windY = band.windX, band.windY
        local gradX, gradY = gradient(region, cell)
        local lift = math.max(0, windX * gradX + windY * gradY)
        local lee = math.max(0, -(windX * gradX + windY * gradY))
        local latitudeRadians = latitudeRadiansFor(world, cell.y or 0)
        local equatorMoisture = 1 - math.abs(latitudeRadians / (math.pi / 2))
        local landFraction = landFractions[cell.gy or 0] or 0
        local monsoonIndex = 0
        if equatorMoisture > 0.5 then
            monsoonIndex = (landFraction - 0.5) * (world.monsoonSeasonalContrast or 1.3) * seasonal
        end
        local baselinePrecip = band.baselinePrecip
        if math.abs(monsoonIndex) > 0.3 then
            baselinePrecip = clamp(baselinePrecip * (1 + clamp(monsoonIndex, -1, 1) * 0.5), 0.02, 1)
        end
        local incoming = cell.incomingMoistureCount > 0 and (cell.incomingMoisture / cell.incomingMoistureCount) or nil
        local sourceNoise = Noise.value(world.seed + 808, (cell.x or 0) * 0.0015, (cell.y or 0) * 0.0015, 11)
        local localSource = (cell.water and 0.42 or 0.12) + baselinePrecip * 0.28 + sourceNoise * 0.12
        local moisture = clamp((incoming or (0.22 + baselinePrecip * 0.72)) + localSource * 0.38, 0.04, 1)
        local condensation = clamp(moisture * lift * (world.orographicLiftScale or 8.5), 0, moisture * 0.72)
        local leeDrying = lee * (world.orographicLeeScale or 1.8)
        local background = baselinePrecip + (cell.water and 0.04 or 0)
        local precipitation = clamp(background + condensation - leeDrying, 0.015, 1)
        local outgoing = clamp(moisture - condensation * 0.85 - leeDrying * 0.05 + (cell.water and 0.16 or 0.012), 0.03, 1)
        local shadow = (lee > 0.001 and precipitation < 0.34) and clamp((0.34 - precipitation) * 2.4 + lee * 18, 0, 1) or 0
        cell.precipitation = precipitation
        cell.rainfall = precipitation
        cell.moisture = precipitation
        cell.airMoisture = moisture
        cell.windX = windX
        cell.windY = windY
        cell.baselinePrecip = baselinePrecip
        cell.pressureCellId = band.pressureCellId
        cell.monsoonIndex = monsoonIndex
        cell.rainShadowScore = shadow
        cell.rainShadow = shadow > 0.35
        if precipitation > maxPrecipitation then maxPrecipitation = precipitation end
        if cell.rainShadow then shadowCells = shadowCells + 1 end
        if store then
            store[climateKey(region.scale, cell.gx, cell.gy)] = {
                precipitation = precipitation,
                rainShadow = shadow,
                windX = windX,
                windY = windY,
                baselinePrecip = baselinePrecip,
                pressureCellId = band.pressureCellId,
                monsoonIndex = monsoonIndex,
            }
        end
        local stepX = windX > 0.35 and 1 or (windX < -0.35 and -1 or 0)
        local stepY = windY > 0.35 and 1 or (windY < -0.35 and -1 or 0)
        if stepX == 0 and stepY == 0 then stepX = windX >= 0 and 1 or -1 end
        local downwind = cellAt(region, cell.gx + stepX, cell.gy + stepY)
        if downwind then
            downwind.incomingMoisture = downwind.incomingMoisture + outgoing
            downwind.incomingMoistureCount = downwind.incomingMoistureCount + 1
        end
    end
    region.climate = {
        maxPrecipitation = maxPrecipitation,
        rainShadowCells = shadowCells,
    }
    return region.climate
end

return Climate
