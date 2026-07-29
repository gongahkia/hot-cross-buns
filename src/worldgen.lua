local Noise = require("src.noise")
local Rng = require("src.rng")
local Hydrology = require("src.hydrology")
local Climate = require("src.climate")
local Lru = require("src.lru")
local Biomes = require("src.biomes")
local Aeolian = require("src.aeolian")
local SoilProduction = require("src.soil_production")
local Orometry = require("src.orometry")
local Periglacial = require("src.periglacial")
local SoilClassify = require("src.soil_classify")
local ffi = require("ffi")

local soaFieldList = { "elevation", "slope", "flow", "temperature", "rainfall", "sediment", "glacialDelta", "glacialErosion", "iceThickness", "isostaticRebound", "streamPowerDelta", "erodibilityK", "lithologyAge", "regolithDepth", "bedrockElevation", "marineTerrace", "fluvialTerrace", "latitudeRadians", "coriolisF", "baselinePrecip", "monsoonIndex", "hotspotContribution", "hotspotAgeMy", "oceanDepthMeters", "oceanAgeMyr", "shelfDistance", "karstDepth", "cavePresence", "reefAccretion", "reefAgeMy", "meanderBend", "hillslopeDelta", "debrisFlowDelta", "archetypeBlend", "volcanicAgeMy", "fireFrequency" }
local soaInt8FieldList = { "water", "river", "riverBank", "lake", "glaciated", "coastCliff", "coastBeach", "talus", "alluvialFan", "floodplain", "delta", "spillover", "rainShadow", "lithology", "paleoShoreline", "riverHistorical", "debrisFlow", "pressureCellId", "isFloodBasalt", "oxbowLake", "karstType", "reefStage", "archetypeId", "volcanicForm", "periglacialFeature", "submarineCanyon", "soilOrder", "treeline", "riparian" }
local soaInt32FieldList = { "plateId", "secondaryPlateId", "hotspotId", "shorelineNode" }
local soaDoubleArray = ffi.typeof("double[?]")
local soaInt8Array = ffi.typeof("int8_t[?]")
local soaInt32Array = ffi.typeof("int32_t[?]")
local soaInt8FieldSet = {}
local soaInt8EnumFieldSet = { lithology = true, pressureCellId = true, karstType = true, reefStage = true, archetypeId = true, volcanicForm = true, periglacialFeature = true, soilOrder = true }
local refSkipFieldSet = { downCell = true }

for _, field in ipairs(soaInt8FieldList) do
    soaInt8FieldSet[field] = true
end

local function soaValue(value)
    if value == true then return 1 end
    if value == false or value == nil then return 0 end
    return value
end

local function allocateChunkArrays(arrays, fields, ctype, total)
    for _, field in ipairs(fields) do
        arrays[field] = ffi.new(ctype, total)
    end
end

local function writeChunkArrays(arrays, fields, cell, index)
    for _, field in ipairs(fields) do
        arrays[field][index] = soaValue(cell[field])
    end
end

local function buildChunkArrays(rows, size)
    local total = size * size
    local arrays = {}
    allocateChunkArrays(arrays, soaFieldList, soaDoubleArray, total)
    allocateChunkArrays(arrays, soaInt8FieldList, soaInt8Array, total)
    allocateChunkArrays(arrays, soaInt32FieldList, soaInt32Array, total)
    for y = 1, size do
        local row = rows[y]
        local base = (y - 1) * size
        for x = 1, size do
            local cell = row[x]
            local index = base + (x - 1)
            writeChunkArrays(arrays, soaFieldList, cell, index)
            writeChunkArrays(arrays, soaInt8FieldList, cell, index)
            writeChunkArrays(arrays, soaInt32FieldList, cell, index)
        end
    end
    return arrays
end

local function buildChunkRefs(rows, size)
    local refs = {}
    for y = 1, size do
        local row = rows[y]
        local base = (y - 1) * size
        for x = 1, size do
            local ref = row[x]
            for _, field in ipairs(soaFieldList) do ref[field] = nil end
            for _, field in ipairs(soaInt8FieldList) do ref[field] = nil end
            for _, field in ipairs(soaInt32FieldList) do ref[field] = nil end
            for field in pairs(refSkipFieldSet) do ref[field] = nil end
            refs[base + (x - 1)] = ref
        end
    end
    return refs
end

local function chunkCellIndex(chunk, x, y)
    if not chunk or x < 1 or y < 1 or x > chunk.size or y > chunk.size then return nil end
    return (y - 1) * chunk.size + (x - 1)
end

local function readChunkArrayValue(chunk, field, index)
    local array = chunk.arrays and chunk.arrays[field]
    if not array then return nil end
    local value = tonumber(array[index]) or 0
    if soaInt8FieldSet[field] and not soaInt8EnumFieldSet[field] then return value ~= 0 end
    return value
end

local function chunkCellAt(chunk, x, y)
    local index = chunkCellIndex(chunk, x, y)
    if not index then return nil end
    local cell = {}
    local ref = chunk.refs and chunk.refs[index]
    if ref then
        for field, value in pairs(ref) do cell[field] = value end
    elseif chunk.rawCells then
        for field, value in pairs(chunk.rawCells[y][x]) do cell[field] = value end
    end
    for _, field in ipairs(soaFieldList) do cell[field] = readChunkArrayValue(chunk, field, index) end
    for _, field in ipairs(soaInt8FieldList) do cell[field] = readChunkArrayValue(chunk, field, index) end
    for _, field in ipairs(soaInt32FieldList) do cell[field] = readChunkArrayValue(chunk, field, index) end
    cell.koppen = Biomes.koppen(cell.temperature, cell.rainfall or cell.precipitation, cell)
    return cell
end

local function chunkCellsProxy(chunk)
    return setmetatable({}, {
        __index = function(_, y)
            if type(y) ~= "number" or y < 1 or y > chunk.size then return nil end
            chunk.rowProxies = chunk.rowProxies or {}
            local row = chunk.rowProxies[y]
            if row then return row end
            row = setmetatable({}, {
                __index = function(_, x)
                    if type(x) ~= "number" or x < 1 or x > chunk.size then return nil end
                    return chunkCellAt(chunk, x, y)
                end,
            })
            chunk.rowProxies[y] = row
            return row
        end,
    })
end

local function packChunkCells(chunk, rows)
    chunk.arrays = buildChunkArrays(rows, chunk.size)
    chunk.refs = buildChunkRefs(rows, chunk.size)
    chunk.rawCells = nil
    chunk.rowProxies = nil
    chunk.cells = chunkCellsProxy(chunk)
    return chunk
end

local lithologyTable = {
    [0] = { name = "unknown", density = 2.7, erodibilityK = 1.0, albedo = 0.25 },
    [1] = { name = "basalt", density = 3.0, erodibilityK = 0.6, albedo = 0.18 },
    [2] = { name = "granite", density = 2.65, erodibilityK = 0.5, albedo = 0.32 },
    [3] = { name = "gneiss", density = 2.75, erodibilityK = 0.4, albedo = 0.3 },
    [4] = { name = "carbonate", density = 2.7, erodibilityK = 1.4, albedo = 0.48 },
    [5] = { name = "sandstone", density = 2.3, erodibilityK = 0.9, albedo = 0.42 },
    [6] = { name = "shale", density = 2.4, erodibilityK = 1.2, albedo = 0.24 },
    [7] = { name = "evaporite", density = 2.2, erodibilityK = 1.6, albedo = 0.62 },
}

local WorldGen = {}
WorldGen.__index = WorldGen

local scales = {
    { id = "local", factor = 1, label = "local" },
    { id = "region", factor = 4, label = "region" },
    { id = "continent", factor = 16, label = "continent" },
}

local scaleById = {}
for _, scale in ipairs(scales) do
    scaleById[scale.id] = scale
    scaleById[scale.factor] = scale
end

local biomeIds = {
    ocean = true,
    coast = true,
    lake = true,
    river = true,
    wetland = true,
    desert = true,
    cold_desert = true,
    polar_desert = true,
    semiarid_shrubland = true,
    playa_salt_flat = true,
    dune_sea_erg = true,
    badland = true,
    oasis = true,
    grassland = true,
    savanna = true,
    temperate_forest = true,
    temperate_rainforest = true,
    mixed_forest = true,
    conifer_forest = true,
    rainforest = true,
    monsoon_forest = true,
    dry_broadleaf = true,
    cloud_forest = true,
    thorn_scrub = true,
    mediterranean_chaparral = true,
    mangrove = true,
    riparian_gallery_forest = true,
    boreal_forest = true,
    muskeg = true,
    subalpine_krummholz = true,
    tundra = true,
    permafrost_polygon = true,
    alpine = true,
    alpine_scree = true,
    nival_zone = true,
    snow = true,
    rock = true,
    lava_flow = true,
    shield = true,
    karst = true,
    reef = true,
    lagoon = true,
    kelp_forest_fringe = true,
    atoll_ring = true,
    seamount_cap = true,
    fumarole_field = true,
    hot_spring_travertine = true,
    ash_plain = true,
    bioluminescent_grove = true,
    red_algal_shore = true,
    salt_cathedral = true,
    blue_ice_field = true,
}

local billboardKinds = {
    tree_deciduous = true,
    tree_conifer = true,
    tree_dead = true,
    reed = true,
    rock = true,
    shrub = true,
    snow_tuft = true,
    peak = true,
    ridge = true,
    outcrop = true,
}

local discoveryKinds = {
    mountain_range = true,
    watershed = true,
    basin = true,
    coast = true,
    ridge = true,
    pass = true,
    rain_shadow = true,
}

local discoveryAdjectives = {
    "Ash",
    "Cedar",
    "Granite",
    "High",
    "Iron",
    "Mist",
    "Silver",
    "Wind",
}

local discoveryNouns = {
    mountain_range = "Range",
    watershed = "Watershed",
    basin = "Basin",
    coast = "Coast",
    ridge = "Ridge",
    pass = "Pass",
    rain_shadow = "Rain Shadow",
}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function smoothstep(minValue, maxValue, value)
    local t = clamp((value - minValue) / (maxValue - minValue), 0, 1)
    return t * t * (3 - 2 * t)
end

local function floorDiv(value, divisor)
    return math.floor(value / divisor)
end

local function key(...)
    local parts = {}
    for index = 1, select("#", ...) do
        parts[index] = tostring(select(index, ...))
    end
    return table.concat(parts, ":")
end

local function textHash(text)
    local h = 0
    for index = 1, #tostring(text or "") do
        h = (h * 33 + string.byte(text, index)) % 2147483647
    end
    return h
end

local function discoveryName(seed, kind, id)
    local h = Rng.hash(seed, textHash(kind), textHash(id), 907)
    local adjective = discoveryAdjectives[(h % #discoveryAdjectives) + 1]
    return adjective .. " " .. (discoveryNouns[kind] or "Feature")
end

local function scaleInfo(scale)
    return scaleById[scale or "local"] or scales[1]
end

local function validScope(scope)
    return scaleInfo(scope).id
end

local function plateCacheKey(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function plateDrift(vx, vy, cellSize, time)
    if not time or time == 0 then return 0, 0 end
    local driftScale = cellSize * 0.4 -- clamp drift below 80% half-cell so plates do not collide
    return math.tanh(vx * time) * driftScale, math.tanh(vy * time) * driftScale
end

local function wrapMantle(value, extent)
    return value - math.floor(value / extent) * extent
end

local function mantleDelta(a, b, extent)
    local delta = math.abs(a - b)
    if delta > extent * 0.5 then delta = extent - delta end
    return delta
end

local function mantleDistance2(ax, ay, bx, by, extent)
    local dx = mantleDelta(ax, bx, extent)
    local dy = mantleDelta(ay, by, extent)
    return dx * dx + dy * dy
end

local function gdh1DepthMeters(ageMyr)
    local t = math.max(0, ageMyr or 0)
    if t < 20 then return 2600 + 365 * math.sqrt(t) end
    return 5651 - 2473 * math.exp(-t / 36)
end

local function oceanAgeElevation(world, plate, seaLevel)
    local ageMyr = clamp(plate.age or 0, 0, 1) * (world.maxOceanAgeMyr or 180)
    local depthMeters = gdh1DepthMeters(ageMyr)
    return (seaLevel or world:seaLevelAt(world.geologicTime)) - depthMeters / (world.zScale or 10000), depthMeters, ageMyr
end

local function seamountAt(world, x, y, info, plate, shelfProximity)
    if plate.crust ~= "oceanic" or (shelfProximity or 0) > 0.45 then return 0 end
    local spacing = 10 * info.factor
    local ix = floorDiv(math.floor(x), spacing)
    local iy = floorDiv(math.floor(y), spacing)
    local contribution = 0
    for gy = iy - 1, iy + 1 do
        for gx = ix - 1, ix + 1 do
            if Rng.unitAt(world.seed, gx, gy, 1411) < 0.18 then
                local jx = Rng.signed(world.seed, gx, gy, 1413) * spacing * 0.35
                local jy = Rng.signed(world.seed, gx, gy, 1415) * spacing * 0.35
                local cx = (gx + 0.5) * spacing + jx
                local cy = (gy + 0.5) * spacing + jy
                local dx, dy = x - cx, y - cy
                local rScale = 1.5 * info.factor
                contribution = math.max(contribution, 0.08 * math.exp(-(dx * dx + dy * dy) / (rScale * rScale)))
            end
        end
    end
    return contribution
end

local function hotspotBucketKey(x, y, bucketSize)
    return floorDiv(x, bucketSize) .. ":" .. floorDiv(y, bucketSize)
end

local function buildHotspots(world)
    local seed = world.seed
    local count = world.hotspotCount or 64
    local extent = world.hotspotMantleExtent or 65536
    local minSeparation = world.hotspotMinSeparation or 4096
    local bucketSize = world.hotspotBucketSize or 8192
    local hotspots, grid = {}, {}
    local rng = Rng.new(seed + 1201)
    local attempt, maxAttempts = 0, count * 320
    while #hotspots < count and attempt < maxAttempts do
        attempt = attempt + 1
        local x = rng:unit() * extent
        local y = rng:unit() * extent
        local ok = true
        for _, hotspot in ipairs(hotspots) do
            if mantleDistance2(x, y, hotspot.x, hotspot.y, extent) < minSeparation * minSeparation then
                ok = false
                break
            end
        end
        if ok then
            local id = #hotspots + 1
            local hotspot = {
                id = id,
                x = x,
                y = y,
                intensity = 0.72 + rng:unit() * 0.56,
            }
            hotspots[id] = hotspot
            local bucket = hotspotBucketKey(x, y, bucketSize)
            grid[bucket] = grid[bucket] or {}
            grid[bucket][#grid[bucket] + 1] = id
        end
    end
    return hotspots, grid
end

local function hotspotAt(world, wx, wy, plate)
    if not (world.hotspots and world.hotspotGrid) then return { contribution = 0, hotspotId = 0, hotspotAgeMy = 0, isFloodBasalt = false } end
    local extent = world.hotspotMantleExtent or 65536
    local bucketSize = world.hotspotBucketSize or 8192
    local bucketCount = math.max(1, math.floor(extent / bucketSize))
    local sigma = world.hotspotSigma or 1024
    local sigma2 = sigma * sigma
    local maxDistance2 = sigma2 * 9
    local trailDt = world.hotspotTrailDt or 0.2
    local trailSteps = world.hotspotTrailSteps or 8
    local tau = world.hotspotTau or 3
    local currentDx, currentDy = plateDrift(plate.vx or 0, plate.vy or 0, world.plateCellSize or 640, world.geologicTime or 0)
    local mantleX = wrapMantle(wx - currentDx, extent)
    local mantleY = wrapMantle(wy - currentDy, extent)
    local maxTrail = math.min(trailSteps - 1, math.floor(math.max(0, world.geologicTime or 0) / math.max(0.000001, trailDt)))
    local sum, bestWeight, bestId, bestAge = 0, 0, 0, 0
    local bucketRadius = math.max(1, math.ceil((world.hotspotSigma or 1024) * 3 / bucketSize))
    for ageIndex = 0, maxTrail do
        local pastDx, pastDy = plateDrift(plate.vx or 0, plate.vy or 0, world.plateCellSize or 640, ageIndex * trailDt)
        local targetX = wrapMantle(mantleX + pastDx, extent)
        local targetY = wrapMantle(mantleY + pastDy, extent)
        local bx, by = floorDiv(targetX, bucketSize), floorDiv(targetY, bucketSize)
        local ageDecay = math.exp(-ageIndex / tau)
        for oy = -bucketRadius, bucketRadius do
            for ox = -bucketRadius, bucketRadius do
                local nx = (bx + ox) % bucketCount
                local ny = (by + oy) % bucketCount
                local bucket = world.hotspotGrid[nx .. ":" .. ny]
                if bucket then
                    for _, id in ipairs(bucket) do
                        local hotspot = world.hotspots[id]
                        local d2 = mantleDistance2(targetX, targetY, hotspot.x, hotspot.y, extent)
                        if d2 <= maxDistance2 then
                            local weight = hotspot.intensity * math.exp(-d2 / sigma2) * ageDecay
                            sum = sum + weight
                            if weight > bestWeight then
                                bestWeight = weight
                                bestId = hotspot.id
                                bestAge = ageIndex * trailDt * 100
                            end
                        end
                    end
                end
            end
        end
    end
    local contribution = clamp(sum * (world.hotspotElevationScale or 0.42), 0, 0.45)
    return {
        contribution = contribution,
        hotspotId = bestId,
        hotspotAgeMy = bestAge,
        isFloodBasalt = contribution > (world.floodBasaltThreshold or 0.34) and (plate.boundary or 1) < 0.18,
        intensity = bestWeight,
    }
end

local function buildPlateCenter(seed, gx, gy, cellSize, time)
    local jitterX = Rng.signed(seed, gx, gy, 11) * cellSize * 0.38
    local jitterY = Rng.signed(seed, gx, gy, 23) * cellSize * 0.38
    local id = Rng.hash(seed, gx, gy, 37)
    local angle = Rng.unitAt(seed, gx, gy, 41) * math.pi * 2
    local speed = 0.25 + Rng.unitAt(seed, gx, gy, 43) * 0.75
    local crust = Rng.unitAt(seed, gx, gy, 47) > 0.66 and "continental" or "oceanic"
    local age = Rng.unitAt(seed, gx, gy, 49)
    local vx = math.cos(angle) * speed
    local vy = math.sin(angle) * speed
    local dx, dy = plateDrift(vx, vy, cellSize, time)
    return {
        id = id,
        gx = gx,
        gy = gy,
        x = (gx + 0.5) * cellSize + jitterX + dx,
        y = (gy + 0.5) * cellSize + jitterY + dy,
        vx = vx,
        vy = vy,
        crust = crust,
        age = age,
    }
end

local function plateCenter(seed, gx, gy, cellSize, cache, time)
    if not cache then return buildPlateCenter(seed, gx, gy, cellSize, time) end
    local cacheKey = plateCacheKey(gx, gy)
    local plate = cache:get(cacheKey)
    if plate then return plate end
    plate = buildPlateCenter(seed, gx, gy, cellSize, time)
    cache:set(cacheKey, plate)
    return plate
end

local function twoNearestPlates(seed, x, y, cellSize, cache, time)
    local gx, gy = floorDiv(x, cellSize), floorDiv(y, cellSize)
    local first, second
    for yy = gy - 1, gy + 1 do
        for xx = gx - 1, gx + 1 do
            local plate = plateCenter(seed, xx, yy, cellSize, cache, time)
            local dx, dy = x - plate.x, y - plate.y
            plate.distance = math.sqrt(dx * dx + dy * dy)
            if not first or plate.distance < first.distance then
                second = first
                first = plate
            elseif not second or plate.distance < second.distance then
                second = plate
            end
        end
    end
    return first, second
end

local function classifyBiome(elevation, water, river, temperature, moisture, slope, lake, cell, allowExotic)
    if lake then return "lake" end
    if river then return "river" end
    return Biomes.lookup(temperature, moisture, elevation, water, slope, cell and cell.hotspotContribution or 0, cell and cell.isFloodBasalt, cell and cell.karstType or 0, cell and cell.reefStage or 0, allowExotic, cell)
end

local function lithologyProps(id)
    return lithologyTable[id] or lithologyTable[0]
end

local function setLithology(cell, id, age)
    local props = lithologyProps(id)
    cell.lithology = id
    cell.erodibilityK = props.erodibilityK
    cell.lithologyAge = age or cell.lithologyAge or 0
end

local function classifyLithology(world, plate, x, y, latitudeUnit, rainfall, elevation, shield, craton, riftValley, islandArc)
    local age = plate.age or 0
    local boundary = plate.boundary or 0
    local seaLevel = world:seaLevelAt(world.geologicTime)
    if plate.crust == "oceanic" then
        if age < 0.1 then return 1, lithologyProps(1).erodibilityK, age end
        if age > 0.7 then return 6, lithologyProps(6).erodibilityK, age end
        if elevation < seaLevel - 0.18 and boundary < 0.18 then return 0, lithologyProps(0).erodibilityK, age end
        if (islandArc or 0) > 0.2 or boundary > 0.45 then return 1, lithologyProps(1).erodibilityK, age end
        return 5, lithologyProps(5).erodibilityK, age
    end
    local stableMass = (shield or 0) + (craton or 0)
    if stableMass > 0.5 then
        local roll = Rng.unitAt(world.seed, math.floor(x), math.floor(y), 1031)
        local id = roll < 0.5 and 2 or 3
        return id, lithologyProps(id).erodibilityK, age
    end
    if boundary < 0.24 and latitudeUnit < 0.5 and (rainfall or 0) > 0.16 then return 4, lithologyProps(4).erodibilityK, age end
    if (rainfall or 0) < 0.18 and boundary < 0.35 then return 5, lithologyProps(5).erodibilityK, age end
    if boundary > 0.5 or (riftValley or 0) > 0.28 then
        local id = Rng.unitAt(world.seed, math.floor(x), math.floor(y), 1031) < 0.55 and 3 or 2
        return id, lithologyProps(id).erodibilityK, age
    end
    local id = (rainfall or 0) > 0.55 and 6 or 5
    return id, lithologyProps(id).erodibilityK, age
end

local function copyCell(cell)
    local out = {}
    for k, v in pairs(cell) do out[k] = v end
    return out
end

local function option(value, fallback)
    if value == nil then return fallback end
    return value
end

local function seaLevelPhase(seed, salt)
    return Rng.unitAt(seed, salt, 1051) * math.pi * 2
end

local function buildSeaLevelConfig(seed, options)
    return {
        base = option(options.seaLevel, 0),
        amplitude1 = option(options.seaLevelAmplitude1, 0.012),
        period1 = option(options.seaLevelPeriod1, 0.1),
        phase1 = seaLevelPhase(seed, 1),
        amplitude2 = option(options.seaLevelAmplitude2, 0.005),
        period2 = option(options.seaLevelPeriod2, 0.041),
        phase2 = seaLevelPhase(seed, 2),
        residualAmplitude = option(options.seaLevelResidualAmplitude, 0.003),
        residualPhase1 = seaLevelPhase(seed, 3),
        residualPhase2 = seaLevelPhase(seed, 4),
    }
end

local function cycleLevel(t, amplitude, period, phase)
    if amplitude == 0 or period == 0 then return 0 end
    return amplitude * (math.sin((math.pi * 2 * t) / period + phase) - math.sin(phase))
end

local function seaLevelAtConfig(config, t)
    t = t or 0
    local residual = cycleLevel(t, config.residualAmplitude * 0.65, 0.023, config.residualPhase1)
        + cycleLevel(t, config.residualAmplitude * 0.35, 0.071, config.residualPhase2)
    return config.base
        + cycleLevel(t, config.amplitude1, config.period1, config.phase1)
        + cycleLevel(t, config.amplitude2, config.period2, config.phase2)
        + residual
end

local function buildSeaLevelSeries(config, geologicTime)
    local series, minLevel, maxLevel = {}, math.huge, -math.huge
    local startTime = (geologicTime or 0) - 1
    for index = 1, 128 do
        local t = startTime + (index - 1) / 127
        local level = seaLevelAtConfig(config, t)
        series[index] = { t = t, level = level }
        if level < minLevel then minLevel = level end
        if level > maxLevel then maxLevel = level end
    end
    return series, minLevel, maxLevel
end

local function legacyLatitudeRadians(seed, y)
    local signed = math.sin((y or 0) * 0.00045 + (seed or 1) * 0.0001)
    return signed * (math.pi / 2)
end

local function geographicLatitudeRadians(y, circumference)
    local yUnit = (y or 0) / (circumference or 4194304)
    local wrappedY = 2 * math.abs(yUnit - math.floor(yUnit + 0.5))
    local phase = (yUnit + 0.5) % 1 - 0.5
    local sign = phase >= 0 and 1 or -1
    return (1 - wrappedY) * (math.pi / 2) * sign
end

local function streamPowerSampleAt(store, scale, gx, gy)
    local sample = store[key(scale, gx, gy)]
    if sample == nil then return nil, nil end
    if type(sample) == "table" then return sample.delta or 0, sample.sediment or 0, sample.glacialDelta or 0, sample.glaciated or 0, sample.isostaticRebound or 0, sample.hillslopeDelta or 0, sample.debrisFlowDelta or 0, sample.debrisFlow or 0, sample.iceThickness or 0 end
    return sample, 0, 0, 0, 0, 0, 0, 0, 0
end

local function streamPowerAt(world, info, x, y)
    if (world.streamPowerSampleDepth or 0) > 0 then return nil, nil end
    local store = world.streamPowerSamples
    if not store then return nil, nil end
    local stride = math.max(1, world.hydrologyBasinStride or 1)
    if stride <= 1 then return nil, nil end
    local scaleX = x / info.factor
    local scaleY = y / info.factor
    local bx = (scaleX - (stride - 1) * 0.5) / stride
    local by = (scaleY - (stride - 1) * 0.5) / stride
    local ix = math.floor(bx)
    local iy = math.floor(by)
    local tx = bx - ix
    local ty = by - iy
    local d00, s00, g00, i00, r00, h00, b00, f00, t00 = streamPowerSampleAt(store, info.id, ix, iy)
    local d10, s10, g10, i10, r10, h10, b10, f10, t10 = streamPowerSampleAt(store, info.id, ix + 1, iy)
    local d01, s01, g01, i01, r01, h01, b01, f01, t01 = streamPowerSampleAt(store, info.id, ix, iy + 1)
    local d11, s11, g11, i11, r11, h11, b11, f11, t11 = streamPowerSampleAt(store, info.id, ix + 1, iy + 1)
    if d00 and d10 and d01 and d11 then
        local dx0 = d00 + (d10 - d00) * tx
        local dx1 = d01 + (d11 - d01) * tx
        local sx0 = s00 + (s10 - s00) * tx
        local sx1 = s01 + (s11 - s01) * tx
        local gx0 = g00 + (g10 - g00) * tx
        local gx1 = g01 + (g11 - g01) * tx
        local ix0 = i00 + (i10 - i00) * tx
        local ix1 = i01 + (i11 - i01) * tx
        local rx0 = r00 + (r10 - r00) * tx
        local rx1 = r01 + (r11 - r01) * tx
        local hx0 = h00 + (h10 - h00) * tx
        local hx1 = h01 + (h11 - h01) * tx
        local bx0 = b00 + (b10 - b00) * tx
        local bx1 = b01 + (b11 - b01) * tx
        local fx0 = f00 + (f10 - f00) * tx
        local fx1 = f01 + (f11 - f01) * tx
        local tx0 = t00 + (t10 - t00) * tx
        local tx1 = t01 + (t11 - t01) * tx
        return dx0 + (dx1 - dx0) * ty, sx0 + (sx1 - sx0) * ty, gx0 + (gx1 - gx0) * ty, ix0 + (ix1 - ix0) * ty, rx0 + (rx1 - rx0) * ty, hx0 + (hx1 - hx0) * ty, bx0 + (bx1 - bx0) * ty, fx0 + (fx1 - fx0) * ty, tx0 + (tx1 - tx0) * ty
    end
    return streamPowerSampleAt(store, info.id, math.floor(bx + 0.5), math.floor(by + 0.5))
end

local function cacheKind(cacheKey)
    if string.sub(cacheKey, 1, 9) == "hydrology" then return "hydrology" end
    if string.sub(cacheKey, 1, 5) == "basin" then return "basin" end
    if string.sub(cacheKey, 1, 10) == "billboards" then return "billboard" end
    return "chunk"
end

local defaultCacheLimits = {
    chunk = 2048,
    hydrology = 256,
    basin = 64,
    billboard = 1024,
}

local cacheLimitAliases = {
    chunks = "chunk",
    basins = "basin",
    billboards = "billboard",
}

local function cacheLimits(options)
    local limits, source = {}, options.cacheLimits or {}
    for kind, fallback in pairs(defaultCacheLimits) do
        limits[kind] = option(source[kind], fallback)
    end
    for alias, kind in pairs(cacheLimitAliases) do
        if source[alias] ~= nil then limits[kind] = source[alias] end
    end
    return limits
end

local function totalCacheLimit(limits)
    local total = 0
    for _, limit in pairs(limits) do
        if not limit then return nil end
        total = total + limit
    end
    return total
end

function WorldGen.new(seed, options)
    options = options or {}
    local limits = cacheLimits(options)
    local maxEntries = option(options.cacheMaxEntries, totalCacheLimit(limits))
    local numericSeed = tonumber(seed) or 1
    local geologicTime = option(options.geologicTime, 0)
    local scope = validScope(options.scope)
    local seaLevelConfig = buildSeaLevelConfig(numericSeed, options)
    local seaLevelSeries, seaLevelMin, seaLevelMax = buildSeaLevelSeries(seaLevelConfig, geologicTime)
    local currentSeaLevel = seaLevelAtConfig(seaLevelConfig, geologicTime)
    local world = setmetatable({
        seed = numericSeed,
        scope = scope,
        allowExoticBiomes = options.allowExoticBiomes == true,
        chunkSize = option(options.chunkSize, 64),
        baseSeaLevel = seaLevelConfig.base,
        seaLevel = currentSeaLevel,
        seaLevelConfig = seaLevelConfig,
        seaLevelSeries = seaLevelSeries,
        seaLevelPaleoMin = seaLevelMin,
        seaLevelPaleoMax = seaLevelMax,
        zScale = option(options.zScale, 10000),
        maxOceanAgeMyr = option(options.maxOceanAgeMyr, 180),
        lithologyTable = lithologyTable,
        orometryArchetypes = Orometry.archetypes(),
        orometryBlockChunks = option(options.orometryBlockChunks, 4),
        orometryHaloCells = option(options.orometryHaloCells, 8),
        worldCircumference = option(options.worldCircumference, 4194304),
        omega = option(options.omega, 7.2921e-5),
        legacyLatitude = option(options.legacyLatitude, true),
        plateCellSize = option(options.plateCellSize, 640),
        plateCacheEntries = option(options.plateCacheEntries, 4096),
        plateCache = Lru.new(option(options.plateCacheEntries, 4096)),
        geologicTime = geologicTime,
        geologicTimeStep = option(options.geologicTimeStep, geologicTime > 0 and 0.05 or 0),
        hydrologyRegionChunks = option(options.hydrologyRegionChunks, 2),
        hydrologyHaloCells = option(options.hydrologyHaloCells, 8),
        hydrologyBasinChunks = option(options.hydrologyBasinChunks, 8),
        hydrologyBasinStride = option(options.hydrologyBasinStride, 4),
        hydrologyBasinHaloCells = option(options.hydrologyBasinHaloCells, 0),
        hydrologyBasinFlowScale = option(options.hydrologyBasinFlowScale, 0.6),
        streamPowerIterations = option(options.streamPowerIterations, 80),
        streamPowerK = option(options.streamPowerK, 0.0006),
        streamPowerM = option(options.streamPowerM, 0.5),
        streamPowerN = option(options.streamPowerN, 1.0),
        streamPowerUplift = option(options.streamPowerUplift, "plateBased"),
        streamPowerIsostasy = option(options.streamPowerIsostasy, true),
        streamPowerIsostasyRatio = option(options.streamPowerIsostasyRatio, 0.8),
        streamPowerIsostasyRadius = option(options.streamPowerIsostasyRadius, 4),
        streamPowerDetailScale = option(options.streamPowerDetailScale, 0.45),
        streamPowerSedimentScale = option(options.streamPowerSedimentScale, 0.65),
        hillslopeD = option(options.hillslopeD, 0.005),
        hillslopeSc = option(options.hillslopeSc, 1.2),
        hillslopeIterations = option(options.hillslopeIterations, 1),
        debrisK = option(options.debrisK, 5e-4),
        debrisCriticalConcentration = option(options.debrisCriticalConcentration, 0.4),
        debrisSedimentYield = option(options.debrisSedimentYield, 1.0),
        glacialDetailScale = option(options.glacialDetailScale, 0.8),
        glacialFreezeTemperature = option(options.glacialFreezeTemperature, 0.38),
        glacialSnowline = option(options.glacialSnowline, 0.52),
        glacialMinFlow = options.glacialMinFlow,
        glacialMaxCut = option(options.glacialMaxCut, 0.075),
        glacialGamma = option(options.glacialGamma, 4.4e-9),
        glacialBeta = option(options.glacialBeta, 0.008),
        glacialBmax = option(options.glacialBmax, 2),
        glacialKg = option(options.glacialKg, 5e-5),
        glacialSiaIterations = option(options.glacialSiaIterations, 3),
        iceField = Lru.new(option(options.iceFieldEntries, math.max(8, limits.hydrology * 2))),
        streamPowerSamples = {},
        climateSamples = {},
        seasonRate = option(options.seasonRate, 1.0),
        itczOffsetAmp = option(options.itczOffsetAmp, 0.17),
        monsoonSeasonalContrast = option(options.monsoonSeasonalContrast, 1.3),
        windCoriolisScale = option(options.windCoriolisScale, 0.22),
        hotspotCount = option(options.hotspotCount, 64),
        hotspotMantleExtent = option(options.hotspotMantleExtent, 65536),
        hotspotMinSeparation = option(options.hotspotMinSeparation, 4096),
        hotspotBucketSize = option(options.hotspotBucketSize, 8192),
        hotspotSigma = option(options.hotspotSigma, 1024),
        hotspotTrailSteps = option(options.hotspotTrailSteps, 8),
        hotspotTrailDt = option(options.hotspotTrailDt, 0.2),
        hotspotTau = option(options.hotspotTau, 3),
        hotspotElevationScale = option(options.hotspotElevationScale, 0.42),
        floodBasaltThreshold = option(options.floodBasaltThreshold, 0.34),
        volcanicArcThreshold = option(options.volcanicArcThreshold, 0.04),
        volcanicHotspotThreshold = option(options.volcanicHotspotThreshold, 0.25),
        meanderWidthScale = option(options.meanderWidthScale, 1.8),
        meanderMigrationScale = option(options.meanderMigrationScale, 0.72),
        orographicLiftScale = option(options.orographicLiftScale, 8.5),
        orographicLeeScale = option(options.orographicLeeScale, 2.4),
        cacheMaxEntries = maxEntries,
        cacheLimits = limits,
        cache = {},
        cacheMeta = {},
        cacheSize = 0,
        cacheOrder = maxEntries and Lru.new(maxEntries) or nil,
        cacheStores = {
            chunk = Lru.new(limits.chunk),
            hydrology = Lru.new(limits.hydrology),
            basin = Lru.new(limits.basin),
            billboard = Lru.new(limits.billboard),
        },
        metrics = {
            chunkMisses = 0,
            hydrologyMisses = 0,
            billboardMisses = 0,
            basinMisses = 0,
            hydrologyCells = 0,
            basinCells = 0,
            cacheHits = 0,
            cacheMisses = 0,
            cachePuts = 0,
            cacheEvictions = 0,
            cacheEvictionsByKind = { chunk = 0, hydrology = 0, basin = 0, billboard = 0 },
        },
    }, WorldGen)
    world.climateBands = Climate.buildBands(world)
    world.hotspots, world.hotspotGrid = buildHotspots(world)
    return world
end

function WorldGen.benchmarkPlates(options)
    options = options or {}
    local count = options.count or 10000
    local seed = options.seed or 20260625
    local cellSize = options.cellSize or 640
    local cacheLimit = options.cacheLimit or 4096
    local function coords(index)
        local n = index - 1
        return (n % 100) * 7.25, math.floor(n / 100) * 7.25
    end
    local function run(cache)
        local checksum = 0
        local started = os.clock()
        for index = 1, count do
            local x, y = coords(index)
            local first, second = twoNearestPlates(seed, x, y, cellSize, cache)
            checksum = checksum + (first.id % 997) + (second.id % 991)
        end
        return {
            seconds = math.max(0.000001, os.clock() - started),
            checksum = checksum,
            cacheEntries = cache and cache.count or 0,
        }
    end
    local cold = run(nil)
    local cached = run(Lru.new(cacheLimit))
    return {
        count = count,
        cold = cold,
        cached = cached,
        speedup = cold.seconds / cached.seconds,
    }
end

function WorldGen.scaleInfo(scale)
    return scaleInfo(scale)
end

function WorldGen.validScope(scope)
    return validScope(scope)
end

function WorldGen.biomeIds()
    local result = {}
    for id in pairs(biomeIds) do result[#result + 1] = id end
    table.sort(result)
    return result
end

function WorldGen.billboardKinds()
    local result = {}
    for id in pairs(billboardKinds) do result[#result + 1] = id end
    table.sort(result)
    return result
end

function WorldGen.discoveryKinds()
    local result = {}
    for id in pairs(discoveryKinds) do result[#result + 1] = id end
    table.sort(result)
    return result
end

function WorldGen.gdh1DepthMeters(ageMyr)
    return gdh1DepthMeters(ageMyr)
end

function WorldGen:oceanAgeElevation(plate, seaLevel)
    return oceanAgeElevation(self, plate, seaLevel)
end

function WorldGen:isValidBiome(id)
    return biomeIds[id] == true
end

function WorldGen:metadata()
    return {
        version = "terrain_proto_v1",
        seed = self.seed,
        scope = self.scope,
        allowExoticBiomes = self.allowExoticBiomes == true,
        chunkSize = self.chunkSize,
        seaLevel = self.seaLevel,
        baseSeaLevel = self.baseSeaLevel,
        seaLevelAmplitude1 = self.seaLevelConfig.amplitude1,
        seaLevelPeriod1 = self.seaLevelConfig.period1,
        seaLevelAmplitude2 = self.seaLevelConfig.amplitude2,
        seaLevelPeriod2 = self.seaLevelConfig.period2,
        seaLevelResidualAmplitude = self.seaLevelConfig.residualAmplitude,
        seaLevelPaleoMin = self.seaLevelPaleoMin,
        seaLevelPaleoMax = self.seaLevelPaleoMax,
        zScale = self.zScale,
        maxOceanAgeMyr = self.maxOceanAgeMyr,
        worldCircumference = self.worldCircumference,
        omega = self.omega,
        legacyLatitude = self.legacyLatitude,
        hydrologyRegionChunks = self.hydrologyRegionChunks,
        hydrologyHaloCells = self.hydrologyHaloCells,
        hydrologyBasinChunks = self.hydrologyBasinChunks,
        hydrologyBasinStride = self.hydrologyBasinStride,
        hydrologyBasinHaloCells = self.hydrologyBasinHaloCells,
        hydrologyBasinFlowScale = self.hydrologyBasinFlowScale,
        streamPowerIterations = self.streamPowerIterations,
        streamPowerK = self.streamPowerK,
        streamPowerM = self.streamPowerM,
        streamPowerN = self.streamPowerN,
        streamPowerUplift = self.streamPowerUplift,
        streamPowerDetailScale = self.streamPowerDetailScale,
        streamPowerSedimentScale = self.streamPowerSedimentScale,
        hillslopeD = self.hillslopeD,
        hillslopeSc = self.hillslopeSc,
        hillslopeIterations = self.hillslopeIterations,
        debrisK = self.debrisK,
        debrisCriticalConcentration = self.debrisCriticalConcentration,
        debrisSedimentYield = self.debrisSedimentYield,
        glacialDetailScale = self.glacialDetailScale,
        glacialFreezeTemperature = self.glacialFreezeTemperature,
        glacialSnowline = self.glacialSnowline,
        glacialMaxCut = self.glacialMaxCut,
        glacialGamma = self.glacialGamma,
        glacialBeta = self.glacialBeta,
        glacialBmax = self.glacialBmax,
        glacialKg = self.glacialKg,
        glacialSiaIterations = self.glacialSiaIterations,
        seasonRate = self.seasonRate,
        itczOffsetAmp = self.itczOffsetAmp,
        monsoonSeasonalContrast = self.monsoonSeasonalContrast,
        windCoriolisScale = self.windCoriolisScale,
        hotspotCount = self.hotspotCount,
        hotspotMantleExtent = self.hotspotMantleExtent,
        hotspotMinSeparation = self.hotspotMinSeparation,
        hotspotBucketSize = self.hotspotBucketSize,
        hotspotSigma = self.hotspotSigma,
        hotspotTrailSteps = self.hotspotTrailSteps,
        hotspotTrailDt = self.hotspotTrailDt,
        hotspotTau = self.hotspotTau,
        hotspotElevationScale = self.hotspotElevationScale,
        floodBasaltThreshold = self.floodBasaltThreshold,
        meanderWidthScale = self.meanderWidthScale,
        meanderMigrationScale = self.meanderMigrationScale,
        orographicLiftScale = self.orographicLiftScale,
        orographicLeeScale = self.orographicLeeScale,
        cacheMaxEntries = self.cacheMaxEntries,
        cacheLimits = self.cacheLimits,
        plateCacheEntries = self.plateCacheEntries,
        geologicTime = self.geologicTime,
        geologicTimeStep = self.geologicTimeStep,
        scales = scales,
    }
end

function WorldGen:seaLevelAt(t)
    return seaLevelAtConfig(self.seaLevelConfig, t)
end

function WorldGen:geographicLatitudeAt(y)
    return geographicLatitudeRadians(y, self.worldCircumference)
end

function WorldGen:latitudeAt(y)
    if self.legacyLatitude then return legacyLatitudeRadians(self.seed, y) end
    return self:geographicLatitudeAt(y)
end

function WorldGen:coriolisAt(y)
    return 2 * (self.omega or 7.2921e-5) * math.sin(self:geographicLatitudeAt(y))
end

function WorldGen:cacheEvict(cacheKey)
    if not self.cache[cacheKey] then return end
    local meta = self.cacheMeta[cacheKey] or { kind = cacheKind(cacheKey) }
    self.cache[cacheKey] = nil
    self.cacheMeta[cacheKey] = nil
    self.cacheSize = self.cacheSize - 1
    self.metrics.cacheEvictions = self.metrics.cacheEvictions + 1
    self.metrics.cacheEvictionsByKind[meta.kind] = (self.metrics.cacheEvictionsByKind[meta.kind] or 0) + 1
    if self.cacheStores and self.cacheStores[meta.kind] then self.cacheStores[meta.kind]:delete(cacheKey) end
    if self.cacheOrder then self.cacheOrder:delete(cacheKey) end
end

function WorldGen:cacheGet(cacheKey)
    local value = self.cache[cacheKey]
    if value then
        self.metrics.cacheHits = self.metrics.cacheHits + 1
        local meta = self.cacheMeta[cacheKey] or { kind = cacheKind(cacheKey) }
        self.cacheMeta[cacheKey] = meta
        if self.cacheStores and self.cacheStores[meta.kind] then self.cacheStores[meta.kind]:get(cacheKey) end
        if self.cacheOrder then self.cacheOrder:get(cacheKey) end
        return value
    end
    self.metrics.cacheMisses = self.metrics.cacheMisses + 1
    return nil
end

function WorldGen:cachePut(cacheKey, value, kind)
    local cacheType = kind or cacheKind(cacheKey)
    if not self.cache[cacheKey] then self.cacheSize = self.cacheSize + 1 end
    self.cache[cacheKey] = value
    self.cacheMeta[cacheKey] = { kind = cacheType }
    self.metrics.cachePuts = self.metrics.cachePuts + 1
    local store = self.cacheStores and self.cacheStores[cacheType]
    if store then
        local evictedKey = store:set(cacheKey, value)
        if evictedKey then self:cacheEvict(evictedKey) end
    end
    if self.cacheOrder then
        local evictedKey = self.cacheOrder:set(cacheKey, true)
        if evictedKey then self:cacheEvict(evictedKey) end
    end
    return value
end

function WorldGen:startAsyncHydrology(options)
    if not (love and love.thread) then return false end
    self.asyncHydrology = true
    self.asyncPending = {}
    self.asyncOptions = options or {}
    self.asyncPrefix = "thoth.hydro." .. tostring(self.seed) .. "." .. tostring(os.clock())
    self.asyncQueue = love.thread.getChannel(self.asyncPrefix .. ".jobs")
    self.asyncResponse = love.thread.getChannel(self.asyncPrefix .. ".response")
    self.asyncThread = love.thread.newThread("src/worker.lua")
    self.asyncThread:start(self.asyncPrefix)
    self.metrics.asyncHydrologyQueued = 0
    self.metrics.asyncHydrologyCompleted = 0
    self.metrics.asyncHydrologyFailed = 0
    return true
end

function WorldGen:shutdownAsyncHydrology(waitForExit)
    if self.asyncQueue then self.asyncQueue:push({ quit = true }) end
    if waitForExit and self.asyncThread then self.asyncThread:wait() end
    self.asyncHydrology = false
    self.asyncQueue = nil
    self.asyncResponse = nil
    self.asyncThread = nil
    self.asyncPending = {}
end

function WorldGen:queueAsyncChunk(chunkX, chunkY, info)
    if not (self.asyncHydrology and self.asyncQueue) then return end
    local jobKey = key(chunkX, chunkY, info.id)
    if self.asyncPending[jobKey] then return end
    self.asyncPending[jobKey] = true
    self.metrics.asyncHydrologyQueued = (self.metrics.asyncHydrologyQueued or 0) + 1
    self.asyncQueue:push({
        key = jobKey,
        seed = self.seed,
        options = self.asyncOptions,
        chunkX = chunkX,
        chunkY = chunkY,
        scale = info.id,
    })
end

function WorldGen:pollAsyncHydrology(limit)
    if not self.asyncResponse then return 0 end
    local processed = 0
    while processed < (limit or 8) do
        local message = self.asyncResponse:pop()
        if not message then break end
        processed = processed + 1
        self.asyncPending[message.key] = nil
        if message.ok and message.chunk then
            message.chunk.pendingHydrology = false
            packChunkCells(message.chunk, message.chunk.cells)
            self:cachePut(key(message.chunk.x, message.chunk.y, message.chunk.scale), message.chunk, "chunk")
            self.metrics.asyncHydrologyCompleted = (self.metrics.asyncHydrologyCompleted or 0) + 1
        else
            self.metrics.asyncHydrologyFailed = (self.metrics.asyncHydrologyFailed or 0) + 1
            self.asyncError = message.error
        end
    end
    if self.asyncThread and self.asyncThread:getError() then
        self.asyncError = self.asyncThread:getError()
        if not self.asyncErrorCounted then
            self.metrics.asyncHydrologyFailed = (self.metrics.asyncHydrologyFailed or 0) + 1
            self.asyncErrorCounted = true
        end
    end
    return processed
end

function WorldGen:asyncHydrologyPendingCount()
    local count = 0
    for _ in pairs(self.asyncPending or {}) do count = count + 1 end
    return count
end

function WorldGen:plateAt(x, y)
    local first, second = twoNearestPlates(self.seed, x, y, self.plateCellSize, self.plateCache, self.geologicTime)
    local gap = math.max(0, (second.distance or first.distance) - first.distance)
    local boundary = clamp(1 - gap / (self.plateCellSize * 0.34), 0, 1)
    local nx, ny = second.x - first.x, second.y - first.y
    local nlen = math.sqrt(nx * nx + ny * ny)
    if nlen > 0 then nx, ny = nx / nlen, ny / nlen end
    local rel = ((first.vx or 0) - (second.vx or 0)) * nx + ((first.vy or 0) - (second.vy or 0)) * ny
    local convergent = clamp(rel, 0, 1)
    local divergent = clamp(-rel, 0, 1)
    local subducting
    if convergent > 0 then
        if first.crust ~= second.crust then
            subducting = first.crust == "oceanic" and first or second
        elseif first.crust == "oceanic" then
            subducting = first.age >= second.age and first or second
        end
    end
    local currentSubducts = subducting and subducting.id == first.id
    local oceanicSubduction = subducting and boundary * convergent or 0
    local oceanOceanSubduction = oceanicSubduction * ((first.crust == "oceanic" and second.crust == "oceanic") and 1 or 0)
    local continentOceanSubduction = oceanicSubduction * ((first.crust ~= second.crust) and 1 or 0)
    return {
        id = first.id,
        secondaryId = second.id,
        crust = first.crust,
        secondaryCrust = second.crust,
        age = first.age,
        secondaryAge = second.age,
        boundary = boundary,
        convergent = convergent,
        divergent = divergent,
        oceanicSubduction = oceanicSubduction,
        oceanOceanSubduction = oceanOceanSubduction,
        continentOceanSubduction = continentOceanSubduction,
        subducting = currentSubducts == true,
        subductionBias = oceanicSubduction * (currentSubducts and -1 or 1),
        vx = first.vx,
        vy = first.vy,
    }
end

function WorldGen:hotspotAt(x, y, plate)
    return hotspotAt(self, x, y, plate or self:plateAt(x, y))
end

function WorldGen:baseSample(x, y, scale)
    local info = scaleInfo(scale)
    local wx, wy = Noise.warp(self.seed, x, y, { amount = 48 * info.factor, frequency = 0.0015 / info.factor })
    local plate = self:plateAt(wx, wy)
    local hotspot = hotspotAt(self, wx, wy, plate)
    local archetype, archetypeId, archetypeBlend, orometry = nil, 0, 0, Orometry.defaultModifiers()
    if plate.crust == "continental" or plate.secondaryCrust == "continental" then
        archetype, archetypeId, archetypeBlend, orometry = Orometry.pick(self, x, y, info)
    end
    local orometryStrength = archetypeId > 0 and smoothstep(0.08, 0.52, plate.boundary) * archetypeBlend or 0
    local scaleStrength = orometryStrength * 0.38
    local peakAmpScale = 1 + (orometry.peakAmpScale - 1) * scaleStrength
    local ridgeFreqScale = 1 + (orometry.ridgeFreqScale - 1) * scaleStrength
    local reliefScale = 1 + (orometry.reliefScale - 1) * scaleStrength
    local slopeBias = orometry.slopeBias * scaleStrength * 0.35
    local continent = Noise.fbm(self.seed + 101, wx, wy, { frequency = 0.0009, octaves = 5, salt = 1 })
    local rough = Noise.fbm(self.seed + 202, wx, wy, { frequency = 0.008 * ridgeFreqScale / math.sqrt(info.factor), octaves = 5, salt = 2 })
    local ridge = Noise.ridge(self.seed + 303, wx, wy, { frequency = 0.0035 * ridgeFreqScale / math.sqrt(info.factor), octaves = 4, salt = 3 })
    local shield = plate.crust == "continental" and smoothstep(0.52, 0.86, plate.age) * (1 - smoothstep(0.18, 0.46, plate.boundary)) or 0
    local craton = shield * smoothstep(0.74, 0.96, plate.age) * (1 - smoothstep(0.08, 0.26, plate.boundary))
    local stableDamping = clamp(shield * 0.35 + craton * 0.35, 0, 0.62)
    local seaLevel = self:seaLevelAt(self.geologicTime)
    local oceanDepthMeters, oceanAgeMyr = 0, 0
    local shelfDistance, shelfProximity = 999, 0
    local continentalBias
    if plate.crust == "continental" then
        continentalBias = 0.22 + shield * 0.04 + craton * 0.04
    else
        local eAge
        eAge, oceanDepthMeters, oceanAgeMyr = oceanAgeElevation(self, plate, seaLevel)
        local eTect = -0.16
        local marginBlend = plate.secondaryCrust == "continental" and smoothstep(0.05, 0.45, plate.boundary) * 0.35 or 0
        local wOcean = smoothstep(0, 1, 0.46 * (1 - marginBlend))
        shelfProximity = plate.secondaryCrust == "continental" and smoothstep(0.04, 0.42, plate.boundary) or 0
        shelfDistance = shelfProximity > 0 and (1 - shelfProximity) * 50 or 999
        continentalBias = eTect * (1 - wOcean) + eAge * wOcean + shelfProximity * 0.02
    end
    local uplift = plate.boundary * (plate.convergent * 0.52 * peakAmpScale + ridge * 0.26 * reliefScale)
    local continentalRift = (plate.crust == "continental" and plate.secondaryCrust == "continental") and plate.boundary * plate.divergent or 0
    local riftValley = continentalRift * (0.55 + ridge * 0.45)
    local trench = plate.subducting and plate.oceanicSubduction * (0.24 + plate.age * 0.2) or 0
    local subductionUplift = (not plate.subducting) and plate.continentOceanSubduction * 0.24 or 0
    local islandArc = 0
    if (not plate.subducting) and plate.oceanOceanSubduction > 0 then
        local arcNoise = Noise.value(self.seed + 606, wx * 0.014 / math.sqrt(info.factor), wy * 0.014 / math.sqrt(info.factor), 6)
        islandArc = plate.oceanOceanSubduction * smoothstep(0.42, 0.82, arcNoise)
    end
    local roughContribution = (rough - 0.5) * 0.24 * (1 - stableDamping) * reliefScale
    local abyssalNoise = plate.crust == "oceanic" and (Noise.fbm(self.seed + 707, wx, wy, { frequency = 0.014 / math.sqrt(info.factor), octaves = 3, salt = 7 }) - 0.5) * 0.025 * (1 - shelfProximity) or 0
    local seamount = seamountAt(self, wx, wy, info, plate, shelfProximity)
    local elevation = continentalBias + (continent - 0.5) * 0.72 + roughContribution + uplift + subductionUplift + islandArc * 0.36 + hotspot.contribution + abyssalNoise + seamount - riftValley * 0.26 - trench
    local rawStreamPowerDelta, rawSediment, rawGlacialDelta, rawGlaciated, rawIsostaticRebound, rawHillslopeDelta, rawDebrisFlowDelta, rawDebrisFlow, rawIceThickness = streamPowerAt(self, info, x, y)
    local streamPowerDelta = (rawStreamPowerDelta or 0) * (self.streamPowerDetailScale or 0.45)
    local sediment = (rawSediment or 0) * (self.streamPowerSedimentScale or 0.65)
    local glacialDelta = (rawGlacialDelta or 0) * (self.glacialDetailScale or 0.8)
    local isostaticRebound = (rawIsostaticRebound or 0) * (self.streamPowerDetailScale or 0.45)
    local hillslopeDelta = (rawHillslopeDelta or 0) * (self.streamPowerDetailScale or 0.45)
    local debrisFlowDelta = (rawDebrisFlowDelta or 0) * (self.streamPowerDetailScale or 0.45)
    elevation = elevation + streamPowerDelta + sediment + glacialDelta
    local latitudeRadians = self:latitudeAt(y)
    local latitudeUnit = math.abs(latitudeRadians) / (math.pi / 2)
    local geographicLatitude = self:geographicLatitudeAt(y)
    local coriolisF = self:coriolisAt(y)
    local temperature = clamp(1 - latitudeUnit * 1.1 - math.max(0, elevation) * 0.42 + (Noise.fbm(self.seed + 404, x, y, { frequency = 0.002, octaves = 3 }) - 0.5) * 0.18, 0, 1)
    local climate = Climate.sample(self, info, x, y)
    local climateBand = Climate.bandAt(self, y)
    local moistureNoise = Noise.fbm(self.seed + 505, x, y, { frequency = 0.0022, octaves = 4 })
    local baselinePrecip = (climate and climate.baselinePrecip) or climateBand.baselinePrecip
    local fallbackRainfall = clamp(baselinePrecip * 0.55 + moistureNoise * 0.34 + (1 - latitudeUnit) * 0.08 - math.max(0, elevation) * 0.2 - uplift * 0.16 + islandArc * 0.06, 0, 1)
    local rainfall = clamp((climate and climate.precipitation) or fallbackRainfall, 0, 1)
    local lithology, erodibilityK, lithologyAge = classifyLithology(self, plate, x, y, latitudeUnit, rainfall, elevation, shield, craton, riftValley, islandArc)
    local slope = clamp(ridge * 0.1 * peakAmpScale + math.abs(rough - 0.5) * 0.16 * (1 - stableDamping) * reliefScale + plate.boundary * 0.08 + uplift * 0.06 + riftValley * 0.12 + islandArc * 0.18 + hotspot.contribution * 0.08 + trench * 0.08 - shield * 0.025 - craton * 0.035 + slopeBias, 0, 1)
    local water = elevation <= seaLevel
    local ridgeId = (ridge > 0.62 or plate.boundary > 0.55) and key("ridge", info.id, floorDiv(math.floor(wx), 192 * info.factor), floorDiv(math.floor(wy), 192 * info.factor), plate.id) or nil
    local mountainRangeId = (uplift > 0.18 or plate.convergent * plate.boundary > 0.24) and key("range", info.id, plate.id, plate.secondaryId) or nil
    return {
        x = x,
        y = y,
        scale = info.id,
        scaleFactor = info.factor,
        elevationBase = elevation,
        elevation = elevation,
        bedrockElevation = elevation,
        regolithDepth = 0,
        latitudeRadians = geographicLatitude,
        coriolisF = coriolisF,
        baselinePrecip = baselinePrecip,
        pressureCellId = (climate and climate.pressureCellId) or climateBand.pressureCellId,
        monsoonIndex = (climate and climate.monsoonIndex) or 0,
        hotspotContribution = hotspot.contribution,
        hotspotAgeMy = hotspot.hotspotAgeMy,
        hotspotId = hotspot.hotspotId,
        isFloodBasalt = hotspot.isFloodBasalt,
        oceanDepthMeters = oceanDepthMeters,
        oceanAgeMyr = oceanAgeMyr,
        shelfDistance = shelfDistance,
        submarineCanyon = false,
        karstDepth = 0,
        cavePresence = 0,
        karstType = 0,
        reefAccretion = 0,
        reefAgeMy = 0,
        reefStage = 0,
        archetypeId = archetypeId,
        archetypeBlend = archetypeBlend,
        archetypeKey = archetype and archetype.key or nil,
        volcanicForm = 0,
        volcanicAgeMy = 0,
        periglacialFeature = 0,
        soilOrder = 0,
        treeline = 0,
        riparian = 0,
        fireFrequency = 0,
        meanderBend = 0,
        oxbowLake = false,
        marineTerrace = 0,
        fluvialTerrace = 0,
        paleoShoreline = false,
        riverHistorical = false,
        streamPowerDelta = streamPowerDelta,
        hillslopeDelta = hillslopeDelta,
        debrisFlowDelta = debrisFlowDelta,
        debrisFlow = (rawDebrisFlow or 0) > 0.25,
        streamPowerErosion = math.max(0, -streamPowerDelta),
        streamPowerUplift = math.max(0, streamPowerDelta),
        isostaticRebound = isostaticRebound,
        sediment = sediment,
        glacialDelta = glacialDelta,
        glacialErosion = math.max(0, -glacialDelta),
        iceThickness = rawIceThickness or 0,
        lithology = lithology,
        erodibilityK = erodibilityK,
        lithologyAge = lithologyAge,
        glaciated = (rawGlaciated or 0) > 0.35 and temperature < self.glacialFreezeTemperature and elevation > self.glacialSnowline,
        coastCliff = false,
        coastBeach = false,
        coastExposure = 0,
        coastErosion = 0,
        coastDeposition = 0,
        shorelineNode = 0,
        duneDelta = 0,
        duneAmplitude = 0,
        dunePhase = 0,
        water = water,
        plateId = plate.id,
        secondaryPlateId = plate.secondaryId,
        plateBoundary = plate.boundary,
        plateCrust = plate.crust,
        secondaryPlateCrust = plate.secondaryCrust,
        plateAge = plate.age,
        secondaryPlateAge = plate.secondaryAge,
        oceanicSubduction = plate.oceanicSubduction,
        subductionBias = plate.subductionBias,
        riftValley = riftValley,
        volcanicIslandArc = islandArc,
        shield = shield,
        craton = craton,
        ridgeId = ridgeId,
        mountainRangeId = mountainRangeId,
        uplift = uplift,
        precipitation = rainfall,
        windX = climate and climate.windX or climateBand.windX,
        windY = climate and climate.windY or climateBand.windY,
        rainShadow = climate and (climate.rainShadow or 0) > 0.35 or false,
        rainShadowScore = climate and climate.rainShadow or 0,
        rainfall = rainfall,
        temperature = temperature,
        moisture = rainfall,
        slope = slope,
        flow = rainfall,
        erosion = 0,
        deposition = 0,
        thermalErosion = 0,
        talus = false,
        alluvialFan = false,
        floodplain = false,
        delta = false,
        river = false,
        lake = false,
        lakeDepth = 0,
        biome = Biomes.lookup(temperature, rainfall, elevation, water, slope, hotspot.contribution, hotspot.isFloodBasalt, 0, 0, self.allowExoticBiomes == true),
    }
end

function WorldGen:refineLithology(cell)
    if cell and not cell.water and not cell.downCell and (cell.rainfall or 0) < 0.12 then
        setLithology(cell, 7, cell.lithologyAge)
    end
    return cell
end

function WorldGen:baseChunk(chunkX, chunkY, info)
    local size = self.chunkSize
    local rows = {}
    for y = 1, size do
        rows[y] = {}
        for x = 1, size do
            local gx = chunkX * size + x - 1
            local gy = chunkY * size + y - 1
            local cell = self:baseSample(gx * info.factor, gy * info.factor, info.id)
            cell.pendingHydrology = true
            rows[y][x] = cell
        end
    end
    local chunk = {
        x = chunkX,
        y = chunkY,
        scale = info.id,
        scaleFactor = info.factor,
        size = size,
        pendingHydrology = true,
    }
    return packChunkCells(chunk, rows)
end

function WorldGen:pendingSample(x, y, info)
    return {
        x = x,
        y = y,
        scale = info.id,
        scaleFactor = info.factor,
        elevationBase = 0,
        elevation = 0,
        bedrockElevation = 0,
        regolithDepth = 0,
        latitudeRadians = 0,
        coriolisF = 0,
        baselinePrecip = 0,
        pressureCellId = 0,
        monsoonIndex = 0,
        hotspotContribution = 0,
        hotspotAgeMy = 0,
        hotspotId = 0,
        isFloodBasalt = false,
        oceanDepthMeters = 0,
        oceanAgeMyr = 0,
        shelfDistance = 999,
        submarineCanyon = false,
        karstDepth = 0,
        cavePresence = 0,
        karstType = 0,
        reefAccretion = 0,
        reefAgeMy = 0,
        reefStage = 0,
        archetypeId = 0,
        archetypeBlend = 0,
        volcanicForm = 0,
        volcanicAgeMy = 0,
        periglacialFeature = 0,
        soilOrder = 0,
        treeline = 0,
        riparian = 0,
        fireFrequency = 0,
        meanderBend = 0,
        oxbowLake = false,
        marineTerrace = 0,
        fluvialTerrace = 0,
        paleoShoreline = false,
        riverHistorical = false,
        water = false,
        precipitation = 0,
        rainShadow = false,
        rainShadowScore = 0,
        rainfall = 0,
        temperature = 0.5,
        moisture = 0,
        slope = 0,
        flow = 0,
        erosion = 0,
        isostaticRebound = 0,
        sediment = 0,
        glacialDelta = 0,
        glacialErosion = 0,
        iceThickness = 0,
        hillslopeDelta = 0,
        debrisFlowDelta = 0,
        debrisFlow = false,
        lithology = 0,
        erodibilityK = 1,
        lithologyAge = 0,
        glaciated = false,
        coastCliff = false,
        coastBeach = false,
        coastExposure = 0,
        coastErosion = 0,
        coastDeposition = 0,
        shorelineNode = 0,
        duneDelta = 0,
        duneAmplitude = 0,
        dunePhase = 0,
        deposition = 0,
        thermalErosion = 0,
        talus = false,
        alluvialFan = false,
        floodplain = false,
        delta = false,
        river = false,
        lake = false,
        lakeDepth = 0,
        biome = "grassland",
        pendingHydrology = true,
    }
end


function WorldGen:chunk(chunkX, chunkY, scale)
    local info = scaleInfo(scale)
    local cacheKey = key(chunkX, chunkY, info.id)
    local cached = self:cacheGet(cacheKey)
    if cached then
        if cached.pendingHydrology then self:queueAsyncChunk(chunkX, chunkY, info) end
        return cached
    end
    self.metrics.chunkMisses = self.metrics.chunkMisses + 1
    if self.asyncHydrology then
        self:queueAsyncChunk(chunkX, chunkY, info)
        return self:baseChunk(chunkX, chunkY, info)
    end
    local size = self.chunkSize
    local region = Hydrology.region(self, chunkX, chunkY, info)
    local rows = {}
    local duneRegion = { seed = self.seed, scale = info.id, scaleFactor = info.factor, stride = 1, cells = {} }
    for y = 1, size do
        rows[y] = {}
        for x = 1, size do
            local gx = chunkX * size + x - 1
            local gy = chunkY * size + y - 1
            local cell = copyCell(Hydrology.cell(region, gx, gy))
            cell.biome = classifyBiome(cell.elevation, cell.water, cell.river, cell.temperature, cell.moisture, cell.slope, cell.lake, cell, self.allowExoticBiomes == true)
            Biomes.refineCell(cell, self.allowExoticBiomes == true)
            duneRegion.cells[key(gx, gy)] = cell
            rows[y][x] = cell
        end
    end
    Aeolian.applyRegion(duneRegion, { seed = self.seed })
    Periglacial.applyRegion(duneRegion, { seed = self.seed })
    for y = 1, size do
        for x = 1, size do
            SoilProduction.syncCell(rows[y][x])
        end
    end
    SoilClassify.applyRegion(duneRegion)
    local chunk = {
        x = chunkX,
        y = chunkY,
        scale = info.id,
        scaleFactor = info.factor,
        size = size,
    }
    packChunkCells(chunk, rows)
    return self:cachePut(cacheKey, chunk, "chunk")
end

function WorldGen.soaFields()
    local out = {}
    for _, field in ipairs(soaFieldList) do out[#out + 1] = field end
    for _, field in ipairs(soaInt8FieldList) do out[#out + 1] = field end
    for _, field in ipairs(soaInt32FieldList) do out[#out + 1] = field end
    return out
end

function WorldGen.soaDoubleFields()
    local out = {}
    for index, field in ipairs(soaFieldList) do out[index] = field end
    return out
end

function WorldGen.soaInt8Fields()
    local out = {}
    for index, field in ipairs(soaInt8FieldList) do out[index] = field end
    return out
end

function WorldGen.soaInt32Fields()
    local out = {}
    for index, field in ipairs(soaInt32FieldList) do out[index] = field end
    return out
end

function WorldGen:hydrologyStats(chunkX, chunkY, scale)
    return Hydrology.stats(self, chunkX, chunkY, scaleInfo(scale))
end

function WorldGen:preloadAround(x, y, radius, scale)
    local info = scaleInfo(scale)
    local minGX = floorDiv(math.floor(x - radius), info.factor)
    local maxGX = floorDiv(math.floor(x + radius), info.factor)
    local minGY = floorDiv(math.floor(y - radius), info.factor)
    local maxGY = floorDiv(math.floor(y + radius), info.factor)
    local minChunkX = floorDiv(minGX, self.chunkSize)
    local maxChunkX = floorDiv(maxGX, self.chunkSize)
    local minChunkY = floorDiv(minGY, self.chunkSize)
    local maxChunkY = floorDiv(maxGY, self.chunkSize)
    local chunks = 0
    for cy = minChunkY, maxChunkY do
        for cx = minChunkX, maxChunkX do
            if self.asyncHydrology then
                self:queueAsyncChunk(cx, cy, info)
            else
                self:chunk(cx, cy, info.id)
            end
            chunks = chunks + 1
        end
    end
    return chunks
end

function WorldGen:preloadBillboardsAround(x, y, radius)
    local minChunkX = floorDiv(math.floor(x - radius), self.chunkSize)
    local maxChunkX = floorDiv(math.floor(x + radius), self.chunkSize)
    local minChunkY = floorDiv(math.floor(y - radius), self.chunkSize)
    local maxChunkY = floorDiv(math.floor(y + radius), self.chunkSize)
    local chunks = 0
    for cy = minChunkY, maxChunkY do
        for cx = minChunkX, maxChunkX do
            self:billboards(cx, cy)
            chunks = chunks + 1
        end
    end
    return chunks
end

function WorldGen:cacheStats()
    local stats = {
        total = 0,
        chunks = 0,
        hydrology = 0,
        basins = 0,
        billboards = 0,
        maxEntries = self.cacheMaxEntries,
        limits = {
            chunks = self.cacheLimits.chunk,
            hydrology = self.cacheLimits.hydrology,
            basins = self.cacheLimits.basin,
            billboards = self.cacheLimits.billboard,
        },
        evictions = self.metrics.cacheEvictions,
        evictionsByKind = {
            chunks = self.metrics.cacheEvictionsByKind.chunk or 0,
            hydrology = self.metrics.cacheEvictionsByKind.hydrology or 0,
            basins = self.metrics.cacheEvictionsByKind.basin or 0,
            billboards = self.metrics.cacheEvictionsByKind.billboard or 0,
        },
    }
    for cacheKey in pairs(self.cache) do
        stats.total = stats.total + 1
        local kind = (self.cacheMeta[cacheKey] and self.cacheMeta[cacheKey].kind) or cacheKind(cacheKey)
        if kind == "hydrology" then
            stats.hydrology = stats.hydrology + 1
        elseif kind == "basin" then
            stats.basins = stats.basins + 1
        elseif kind == "billboard" then
            stats.billboards = stats.billboards + 1
        else
            stats.chunks = stats.chunks + 1
        end
    end
    return stats
end

function WorldGen:metricsSnapshot()
    return {
        chunkMisses = self.metrics.chunkMisses,
        hydrologyMisses = self.metrics.hydrologyMisses,
        billboardMisses = self.metrics.billboardMisses,
        basinMisses = self.metrics.basinMisses,
        hydrologyCells = self.metrics.hydrologyCells,
        basinCells = self.metrics.basinCells,
        cacheHits = self.metrics.cacheHits,
        cacheMisses = self.metrics.cacheMisses,
        cachePuts = self.metrics.cachePuts,
        cacheEvictions = self.metrics.cacheEvictions,
        evictions = {
            chunks = self.metrics.cacheEvictionsByKind.chunk or 0,
            hydrology = self.metrics.cacheEvictionsByKind.hydrology or 0,
            basins = self.metrics.cacheEvictionsByKind.basin or 0,
            billboards = self.metrics.cacheEvictionsByKind.billboard or 0,
        },
        asyncHydrology = {
            queued = self.metrics.asyncHydrologyQueued or 0,
            completed = self.metrics.asyncHydrologyCompleted or 0,
            failed = self.metrics.asyncHydrologyFailed or 0,
            pending = self:asyncHydrologyPendingCount(),
            error = self.asyncError,
        },
    }
end

function WorldGen:sample(x, y, scale)
    local info = scaleInfo(scale)
    local gx = floorDiv(x, info.factor)
    local gy = floorDiv(y, info.factor)
    local chunkX = floorDiv(gx, self.chunkSize)
    local chunkY = floorDiv(gy, self.chunkSize)
    local lx = gx - chunkX * self.chunkSize
    local ly = gy - chunkY * self.chunkSize
    if self.asyncHydrology then
        local cacheKey = key(chunkX, chunkY, info.id)
        local chunk = self:cacheGet(cacheKey)
        if chunk and not chunk.pendingHydrology then return chunkCellAt(chunk, lx + 1, ly + 1) end
        self:queueAsyncChunk(chunkX, chunkY, info)
        return self:pendingSample(gx * info.factor, gy * info.factor, info)
    end
    return chunkCellAt(self:chunk(chunkX, chunkY, info.id), lx + 1, ly + 1)
end

local function hasLandWaterEdge(world, cell, scale)
    local step = (cell.scaleFactor or 1) * 4
    local hasLand = not cell.water
    local hasWater = cell.water
    local offsets = { { step, 0 }, { -step, 0 }, { 0, step }, { 0, -step } }
    for _, offset in ipairs(offsets) do
        local neighbor = world:sample(cell.x + offset[1], cell.y + offset[2], scale)
        hasLand = hasLand or not neighbor.water
        hasWater = hasWater or neighbor.water
    end
    return hasLand and hasWater
end

local function isPass(world, cell, scale)
    if cell.water or cell.elevation < 0.12 or cell.slope > 0.22 or not cell.mountainRangeId then return false end
    local step = (cell.scaleFactor or 1) * 6
    local east = world:sample(cell.x + step, cell.y, scale)
    local west = world:sample(cell.x - step, cell.y, scale)
    local north = world:sample(cell.x, cell.y - step, scale)
    local south = world:sample(cell.x, cell.y + step, scale)
    local ewHigh = east.elevation > cell.elevation + 0.02 and west.elevation > cell.elevation + 0.02
    local nsHigh = north.elevation > cell.elevation + 0.02 and south.elevation > cell.elevation + 0.02
    return ewHigh or nsHigh or (cell.ridgeId ~= nil and cell.slope < 0.12)
end

local function addDiscovery(list, seen, seed, kind, id, cell)
    if not id or seen[kind .. ":" .. tostring(id)] then return end
    seen[kind .. ":" .. tostring(id)] = true
    list[#list + 1] = {
        kind = kind,
        id = id,
        name = discoveryName(seed, kind, id),
        x = cell.x,
        y = cell.y,
    }
end

function WorldGen:discoveriesAt(x, y, scale)
    local info = scaleInfo(scale)
    local cell = self:sample(x, y, info.id)
    local discoveries = {}
    local seen = {}
    addDiscovery(discoveries, seen, self.seed, "basin", cell.basinId, cell)
    addDiscovery(discoveries, seen, self.seed, "watershed", cell.watershedId, cell)
    addDiscovery(discoveries, seen, self.seed, "ridge", cell.ridgeId, cell)
    addDiscovery(discoveries, seen, self.seed, "mountain_range", cell.mountainRangeId, cell)
    if hasLandWaterEdge(self, cell, info.id) then
        addDiscovery(discoveries, seen, self.seed, "coast", key("coast", info.id, floorDiv(math.floor(cell.x), 128 * info.factor), floorDiv(math.floor(cell.y), 128 * info.factor)), cell)
    end
    if isPass(self, cell, info.id) then
        addDiscovery(discoveries, seen, self.seed, "pass", key("pass", info.id, floorDiv(math.floor(cell.x), 96 * info.factor), floorDiv(math.floor(cell.y), 96 * info.factor)), cell)
    end
    if not cell.water and (cell.rainShadow or ((cell.rainfall or 0) < 0.32 and ((cell.uplift or 0) > 0.12 or (cell.slope or 0) > 0.16))) then
        addDiscovery(discoveries, seen, self.seed, "rain_shadow", key("shadow", info.id, floorDiv(math.floor(cell.x), 160 * info.factor), floorDiv(math.floor(cell.y), 160 * info.factor)), cell)
    end
    return discoveries
end

function WorldGen:heightAt(x, y)
    local ix = math.floor(x)
    local iy = math.floor(y)
    local fx = x - ix
    local fy = y - iy
    local h00 = self:sample(ix, iy, "local").elevation
    local h10 = self:sample(ix + 1, iy, "local").elevation
    local h01 = self:sample(ix, iy + 1, "local").elevation
    local h11 = self:sample(ix + 1, iy + 1, "local").elevation
    local hx0 = h00 + (h10 - h00) * fx
    local hx1 = h01 + (h11 - h01) * fx
    return hx0 + (hx1 - hx0) * fy
end

function WorldGen:normalAt(x, y)
    local scale = 18
    local dx = (self:heightAt(x + 1, y) - self:heightAt(x - 1, y)) * scale * 0.5
    local dy = (self:heightAt(x, y + 1) - self:heightAt(x, y - 1)) * scale * 0.5
    local nx, ny, nz = -dx, -dy, 1
    local length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length <= 0 then return { x = 0, y = 0, z = 1 } end
    return { x = nx / length, y = ny / length, z = nz / length }
end

local billboardForestBiomes = {
    temperate_forest = true,
    rainforest = true,
    boreal_forest = true,
    temperate_rainforest = true,
    cloud_forest = true,
    monsoon_forest = true,
    dry_broadleaf = true,
    mixed_forest = true,
    conifer_forest = true,
    subalpine_krummholz = true,
    riparian_gallery_forest = true,
    mangrove = true,
}

local billboardDryBiomes = {
    grassland = true,
    savanna = true,
    thorn_scrub = true,
    semiarid_shrubland = true,
    mediterranean_chaparral = true,
    badland = true,
}

local billboardRockBiomes = {
    rock = true,
    alpine = true,
    alpine_scree = true,
    nival_zone = true,
}

local billboardDesertBiomes = {
    desert = true,
    cold_desert = true,
    playa_salt_flat = true,
    dune_sea_erg = true,
}

local function billboardSpecFor(seed, cell)
    if cell.water or cell.river then return nil end
    local chance = Rng.unitAt(seed, cell.x, cell.y, 701)
    local kind, width, height, color
    if cell.elevation > 0.58 and cell.slope > 0.2 and chance < 0.22 then
        kind, width, height, color = "peak", 1.8, 3.8, { 0.68, 0.67, 0.62 }
    elseif cell.elevation > 0.16 and cell.slope > 0.18 and chance < 0.12 then
        kind, width, height, color = "ridge", 1.7, 2.2, { 0.42, 0.4, 0.36 }
    elseif cell.elevation > 0.08 and cell.slope > 0.12 and chance < 0.07 then
        kind, width, height, color = "outcrop", 1.4, 1.4, { 0.34, 0.33, 0.29 }
    elseif billboardForestBiomes[cell.biome] and cell.slope < 0.18 and chance < 0.18 then
        if cell.biome == "boreal_forest" or cell.biome == "conifer_forest" or cell.biome == "subalpine_krummholz" then
            kind, width, height, color = "tree_conifer", 1.2, 3.5, { 0.09, 0.26, 0.18 }
        else
            kind, width, height, color = "tree_deciduous", 1.4, 3.2, { 0.08, 0.28, 0.12 }
        end
    elseif billboardDryBiomes[cell.biome] and (cell.rainfall or 0) < 0.34 and chance < 0.035 then
        kind, width, height, color = "tree_dead", 1.0, 2.6, { 0.42, 0.35, 0.25 }
    elseif (cell.biome == "wetland" or cell.biome == "muskeg") and chance < 0.16 then
        kind, width, height, color = "reed", 0.7, 1.8, { 0.28, 0.34, 0.16 }
    elseif billboardRockBiomes[cell.biome] and chance < 0.12 then
        kind, width, height, color = "rock", 1.4, 1.3, { 0.36, 0.34, 0.32 }
    elseif billboardDesertBiomes[cell.biome] and chance < 0.1 then
        kind, width, height, color = "shrub", 0.9, 1.2, { 0.34, 0.28, 0.12 }
    elseif (cell.biome == "snow" or cell.biome == "blue_ice_field" or cell.biome == "polar_desert") and chance < 0.08 then
        kind, width, height, color = "snow_tuft", 0.9, 1.1, { 0.86, 0.88, 0.82 }
    else
        return nil
    end
    local jx = Rng.signed(seed, cell.x, cell.y, 709) * 1.5
    local jy = Rng.signed(seed, cell.x, cell.y, 719) * 1.5
    return {
        kind = kind,
        x = cell.x + jx,
        y = cell.y + jy,
        z = cell.elevation,
        width = width,
        height = height,
        swayPhase = Rng.signed(seed, cell.x, cell.y, 733),
        color = color,
        biome = cell.biome,
    }
end

function WorldGen:billboards(chunkX, chunkY)
    local cacheKey = key("billboards", chunkX, chunkY)
    local cached = self:cacheGet(cacheKey)
    if cached then return cached end
    if self.asyncHydrology then
        local info = scaleInfo("local")
        local chunk = self:cacheGet(key(chunkX, chunkY, info.id))
        if not (chunk and not chunk.pendingHydrology) then
            self:queueAsyncChunk(chunkX, chunkY, info)
            return {}
        end
    end
    self.metrics.billboardMisses = self.metrics.billboardMisses + 1
    local chunk = self:chunk(chunkX, chunkY, "local")
    local result = {}
    for y = 3, chunk.size - 2, 4 do
        for x = 3, chunk.size - 2, 4 do
            local spec = billboardSpecFor(self.seed, chunk.cells[y][x])
            if spec then
                spec.z = self:heightAt(spec.x, spec.y)
                result[#result + 1] = spec
            end
        end
    end
    return self:cachePut(cacheKey, result, "billboard")
end

return WorldGen
