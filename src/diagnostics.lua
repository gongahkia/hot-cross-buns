local WorldGen = require("src.worldgen")

local Diagnostics = {}

local broadSweepThresholds = {
    waterRatioMin = 0,
    waterRatioMax = 1,
    riverRatioMin = 0,
    steepSlopeRatioMax = 1,
    singleBiomeMax = 1,
    minBiomeCount = 1,
}

local defaultSeeds = {}
for index = 1, 32 do
    defaultSeeds[index] = {
        seed = index,
        originChunkY = -56 + ((index - 1) % 8) * 16,
        thresholds = broadSweepThresholds,
    }
end
local badSeeds = {
    { seed = 1, flags = { "water_low" } },
    { seed = 17, flags = { "river_low" } },
    { seed = 9, flags = { "water_high" } },
    { seed = 13, flags = { "water_low" } },
}
local regressionSeeds = {
    { seed = 34, category = "ugly_terrain", flags = { "water_low" } }, -- catch-all dry continent
    { seed = 9, category = "all_water", flags = { "water_high" } }, -- ocean-dominated
    { seed = 1, category = "all_land", flags = { "water_low" } }, -- land-dominated
    { seed = 20260625, category = "broken_seams", maxSeamMismatches = 0 }, -- hydrology seam regression gate
    { seed = 26, category = "river_discontinuities", maxUphillRejects = 0, minRivers = 1 }, -- uphill river gate
    { seed = 17, category = "riverless", flags = { "river_low" } }, -- few rivers despite land
    { seed = 17, category = "single_biome", flags = { "single_biome_high" } }, -- one biome dominates
    { seed = 17, category = "biome_count_low", flags = { "biome_count_low" }, thresholds = { minBiomeCount = 4 } }, -- biome variety collapse
    { seed = 41, category = "steep_slopes", flags = { "steep_slope_high" } }, -- excess steep terrain
    { seed = 43, category = "drowned_basin", flags = { "water_high" } }, -- flooded with no rivers
}

local defaultThresholds = {
    waterRatioMin = 0.45,
    waterRatioMax = 0.9,
    riverRatioMin = 0.001,
    riverRatioMax = 0.12,
    lakeRatioMax = 0.18,
    meanSlopeMax = 0.36,
    steepSlopeRatioMax = 0.62,
    singleBiomeMax = 0.92,
    minBiomeCount = 3,
}

local function copyMap(input)
    local out = {}
    for k, v in pairs(input or {}) do out[k] = v end
    return out
end

local function copyList(input)
    local out = {}
    for index, value in ipairs(input or {}) do out[index] = type(value) == "table" and copyMap(value) or value end
    return out
end

local function mergeThresholds(input)
    local out = copyMap(defaultThresholds)
    for k, v in pairs(input or {}) do out[k] = v end
    return out
end

local function addFlag(stats, message)
    stats.flags[#stats.flags + 1] = message
end

local function sortedBiomeRatios(stats)
    local out = {}
    for id, count in pairs(stats.biomes) do
        out[#out + 1] = { id = id, count = count, ratio = count / math.max(1, stats.cells) }
    end
    table.sort(out, function(a, b)
        if a.count == b.count then return a.id < b.id end
        return a.count > b.count
    end)
    return out
end

local function biomeGroups(biomes, cells, waterRatio)
    local groups = { water = waterRatio, forest = 0, grass = 0, dry = 0, cold = 0, rock = 0 }
    local total = math.max(1, cells)
    for id, count in pairs(biomes) do
        local ratio = count / total
        if id == "temperate_forest" or id == "rainforest" or id == "boreal_forest" or id == "temperate_rainforest" or id == "cloud_forest" or id == "monsoon_forest" or id == "dry_broadleaf" or id == "mixed_forest" or id == "conifer_forest" or id == "riparian_gallery_forest" or id == "mangrove" then
            groups.forest = groups.forest + ratio
        elseif id == "grassland" or id == "savanna" or id == "wetland" or id == "muskeg" or id == "thorn_scrub" or id == "semiarid_shrubland" or id == "mediterranean_chaparral" or id == "oasis" then
            groups.grass = groups.grass + ratio
        elseif id == "desert" or id == "cold_desert" or id == "playa_salt_flat" or id == "dune_sea_erg" or id == "badland" or id == "polar_desert" or id == "salt_cathedral" then
            groups.dry = groups.dry + ratio
        elseif id == "tundra" or id == "snow" or id == "permafrost_polygon" or id == "blue_ice_field" then
            groups.cold = groups.cold + ratio
        elseif id == "rock" or id == "alpine" or id == "alpine_scree" or id == "nival_zone" or id == "subalpine_krummholz" or id == "ash_plain" or id == "fumarole_field" or id == "hot_spring_travertine" then
            groups.rock = groups.rock + ratio
        end
    end
    return groups
end

local function finalize(stats, thresholds)
    stats.landRatio = stats.land / math.max(1, stats.cells)
    stats.waterRatio = stats.water / math.max(1, stats.cells)
    stats.riverRatio = stats.rivers / math.max(1, stats.cells)
    stats.lakeRatio = stats.lakes / math.max(1, stats.cells)
    stats.meanSlope = stats.slopeSum / math.max(1, stats.cells)
    stats.meanNonMountainSlope = stats.nonMountainSlopeSum / math.max(1, stats.nonMountainCells)
    stats.meanPlateBoundarySlope = stats.plateBoundarySlopeSum / math.max(1, stats.plateBoundaryCells)
    stats.meanPlateBoundaryElevation = stats.plateBoundaryElevationSum / math.max(1, stats.plateBoundaryCells)
    stats.steepSlopeRatio = stats.steepSlopes / math.max(1, stats.cells)
    stats.biomeRatios = sortedBiomeRatios(stats)
    stats.biomeGroups = biomeGroups(stats.biomes, stats.cells, stats.waterRatio)
    stats.biomeCount = #stats.biomeRatios
    stats.topBiome = stats.biomeRatios[1]

    if stats.waterRatio < thresholds.waterRatioMin then addFlag(stats, "water_low") end
    if stats.waterRatio > thresholds.waterRatioMax then addFlag(stats, "water_high") end
    if stats.riverRatio < thresholds.riverRatioMin then addFlag(stats, "river_low") end
    if stats.riverRatio > thresholds.riverRatioMax then addFlag(stats, "river_high") end
    if stats.lakeRatio > thresholds.lakeRatioMax then addFlag(stats, "lake_high") end
    if stats.meanSlope > thresholds.meanSlopeMax then addFlag(stats, "mean_slope_high") end
    if stats.steepSlopeRatio > thresholds.steepSlopeRatioMax then addFlag(stats, "steep_slope_high") end
    if stats.biomeCount < thresholds.minBiomeCount then addFlag(stats, "biome_count_low") end
    if stats.topBiome and stats.topBiome.ratio > thresholds.singleBiomeMax then addFlag(stats, "single_biome_high") end
    if (stats.seamMismatches or 0) > 0 then addFlag(stats, "broken_seams") end
    if (stats.uphillRejects or 0) > 0 then addFlag(stats, "river_discontinuity") end
    return stats
end

function Diagnostics.defaultSeeds()
    return copyList(defaultSeeds)
end

function Diagnostics.badSeeds()
    local out = {}
    for index, fixture in ipairs(badSeeds) do
        out[index] = { seed = fixture.seed, flags = copyList(fixture.flags) }
    end
    return out
end

function Diagnostics.regressionSeeds()
    local out = {}
    for index, fixture in ipairs(regressionSeeds) do
        out[index] = {
            seed = fixture.seed,
            category = fixture.category,
            flags = copyList(fixture.flags),
            maxSeamMismatches = fixture.maxSeamMismatches,
            maxUphillRejects = fixture.maxUphillRejects,
            minRivers = fixture.minRivers,
            thresholds = fixture.thresholds and copyMap(fixture.thresholds) or nil,
        }
    end
    return out
end

function Diagnostics.defaultThresholds()
    return copyMap(defaultThresholds)
end

function Diagnostics.analyzeSeed(seed, options)
    options = options or {}
    local fixture = type(seed) == "table" and seed or { seed = seed }
    seed = fixture.seed
    local thresholds = mergeThresholds(options.thresholds)
    for key, value in pairs(fixture.thresholds or {}) do thresholds[key] = value end
    local world = WorldGen.new(seed, options.worldOptions)
    local scale = options.scale or "local"
    local chunkRadius = options.chunkRadius or 1
    local sampleStep = options.sampleStep or 4
    local originChunkX = fixture.originChunkX or options.originChunkX or 0
    local originChunkY = fixture.originChunkY or options.originChunkY or 0
    local stats = {
        seed = seed,
        originChunkX = originChunkX,
        originChunkY = originChunkY,
        scale = scale,
        chunkRadius = chunkRadius,
        sampleStep = sampleStep,
        cells = 0,
        land = 0,
        water = 0,
        rivers = 0,
        lakes = 0,
        slopeSum = 0,
        nonMountainSlopeSum = 0,
        nonMountainCells = 0,
        plateBoundarySlopeSum = 0,
        plateBoundaryElevationSum = 0,
        plateBoundaryCells = 0,
        maxSlope = 0,
        steepSlopes = 0,
        minElevation = math.huge,
        maxElevation = -math.huge,
        maxFlow = 0,
        seamMismatches = 0,
        uphillRejects = 0,
        biomes = {},
        flags = {},
    }

    local seenHydrology = {}
    for cy = originChunkY - chunkRadius, originChunkY + chunkRadius do
        for cx = originChunkX - chunkRadius, originChunkX + chunkRadius do
            local chunk = world:chunk(cx, cy, scale)
            local regionId = chunk.cells[1][1].hydrologyRegion
            if regionId and not seenHydrology[regionId] then
                seenHydrology[regionId] = true
                local hydrology = world:hydrologyStats(cx, cy, scale)
                stats.seamMismatches = stats.seamMismatches + (hydrology.seamMismatches or 0)
                stats.uphillRejects = stats.uphillRejects + (hydrology.uphillRejects or 0)
            end
            for y = 1, chunk.size, sampleStep do
                for x = 1, chunk.size, sampleStep do
                    local cell = chunk.cells[y][x]
                    stats.cells = stats.cells + 1
                    if cell.water then stats.water = stats.water + 1 else stats.land = stats.land + 1 end
                    if cell.river then stats.rivers = stats.rivers + 1 end
                    if cell.lake then stats.lakes = stats.lakes + 1 end
                    local slope = cell.slope or 0
                    stats.slopeSum = stats.slopeSum + slope
                    local nonMountain = (not cell.water) and (cell.plateBoundary or 0) <= 0.35 and not cell.mountainRangeId and cell.biome ~= "alpine" and cell.biome ~= "rock" and cell.biome ~= "snow"
                    if nonMountain then
                        stats.nonMountainSlopeSum = stats.nonMountainSlopeSum + slope
                        stats.nonMountainCells = stats.nonMountainCells + 1
                    end
                    if (cell.plateBoundary or 0) > 0.35 then
                        stats.plateBoundarySlopeSum = stats.plateBoundarySlopeSum + slope
                        stats.plateBoundaryElevationSum = stats.plateBoundaryElevationSum + (cell.elevation or 0)
                        stats.plateBoundaryCells = stats.plateBoundaryCells + 1
                    end
                    if slope > stats.maxSlope then stats.maxSlope = slope end
                    if slope > 0.18 then stats.steepSlopes = stats.steepSlopes + 1 end
                    if cell.elevation < stats.minElevation then stats.minElevation = cell.elevation end
                    if cell.elevation > stats.maxElevation then stats.maxElevation = cell.elevation end
                    if (cell.flow or 0) > stats.maxFlow then stats.maxFlow = cell.flow or 0 end
                    stats.biomes[cell.biome] = (stats.biomes[cell.biome] or 0) + 1
                end
            end
        end
    end
    stats.cache = world:cacheStats()
    stats.metrics = world:metricsSnapshot()
    return finalize(stats, thresholds)
end

function Diagnostics.sweep(options)
    options = options or {}
    local seeds = options.seeds or defaultSeeds
    local results = {}
    local failed = {}
    for _, seed in ipairs(seeds) do
        local stats = Diagnostics.analyzeSeed(seed, options)
        results[#results + 1] = stats
        if #stats.flags > 0 then failed[#failed + 1] = stats end
    end
    return {
        results = results,
        failed = failed,
        thresholds = mergeThresholds(options.thresholds),
    }
end

function Diagnostics.formatResult(stats)
    local top = stats.topBiome and (stats.topBiome.id .. ":" .. string.format("%.3f", stats.topBiome.ratio)) or "none"
    local flags = #stats.flags > 0 and table.concat(stats.flags, ",") or "ok"
    local groups = stats.biomeGroups or {}
    return string.format(
        "seed=%s cells=%d land=%.3f water=%.3f river=%.3f lake=%.3f mean_slope=%.3f non_mountain_slope=%.3f plate_boundary_slope=%.3f plate_boundary_elev=%.3f steep=%.3f forest=%.3f grass=%.3f dry=%.3f cold=%.3f rock=%.3f biomes=%d top=%s max_flow=%.2f seams=%d uphill=%d flags=%s",
        tostring(stats.seed),
        stats.cells,
        stats.landRatio,
        stats.waterRatio,
        stats.riverRatio,
        stats.lakeRatio,
        stats.meanSlope,
        stats.meanNonMountainSlope,
        stats.meanPlateBoundarySlope,
        stats.meanPlateBoundaryElevation,
        stats.steepSlopeRatio,
        groups.forest or 0,
        groups.grass or 0,
        groups.dry or 0,
        groups.cold or 0,
        groups.rock or 0,
        stats.biomeCount,
        top,
        stats.maxFlow,
        stats.seamMismatches or 0,
        stats.uphillRejects or 0,
        flags
    )
end

function Diagnostics.formatFailures(failed)
    local parts = {}
    for _, stats in ipairs(failed or {}) do
        parts[#parts + 1] = Diagnostics.formatResult(stats)
    end
    return table.concat(parts, "\n")
end

return Diagnostics
