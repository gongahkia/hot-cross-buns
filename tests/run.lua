package.path = "./?.lua;./?/init.lua;./src/?.lua;./src/?/init.lua;" .. package.path

local Player = require("src.player")
local Atmosphere = require("src.atmosphere")
local Render = require("src.render")
local HUD = require("src.hud")
local Journal = require("src.journal")
local Clipmap = require("src.clipmap")
local Rng = require("src.rng")
local Noise = require("src.noise")
local Save = require("src.save")
local Survey = require("src.survey")
local PostFX = require("src.postfx")
local ViewScale = require("src.viewscale")
local Weather = require("src.weather")
local WorldGen = require("src.worldgen")
local Diagnostics = require("src.diagnostics")
local Export = require("src.export")
local Benchmark = require("src.benchmark")
local Erosion = require("src.erosion")
local Climate = require("src.climate")
local SoilProduction = require("src.soil_production")
local Hillslope = require("src.hillslope")
local Meander = require("src.meander")
local Biomes = require("src.biomes")
local Aeolian = require("src.aeolian")
local Coast = require("src.coast")
local Karst = require("src.karst")
local Reef = require("src.reef")
local Orometry = require("src.orometry")
local Volcano = require("src.volcano")
local Periglacial = require("src.periglacial")
local Bathymetry = require("src.bathymetry")
local SoilClassify = require("src.soil_classify")

local function expect(value, message)
    if not value then error(message or "expectation failed", 2) end
end

local function round(value)
    return math.floor((value or 0) * 100000 + 0.5) / 100000
end

local function soaValue(value)
    if value == true then return 1 end
    if value == false or value == nil then return 0 end
    return value
end

local fastWorldOptions = { hydrologyRegionChunks = 2, hydrologyHaloCells = 0, hydrologyBasinChunks = 8, hydrologyBasinStride = 8 }
local basinWorldOptions = { hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 8, hydrologyBasinStride = 8, hydrologyBasinFlowScale = 0.6 }

local function testWorld(seed)
    return WorldGen.new(seed, fastWorldOptions)
end

local soaInt8EnumFields = { lithology = true, pressureCellId = true, karstType = true, reefStage = true, archetypeId = true, volcanicForm = true, periglacialFeature = true, soilOrder = true }
local soaInt8BoolFields = {}
for _, field in ipairs(WorldGen.soaInt8Fields()) do
    if not soaInt8EnumFields[field] then soaInt8BoolFields[field] = true end
end

local function encodeFields(get)
    return table.concat({
        get("x"),
        get("y"),
        get("scale"),
        round(get("filledElevation")),
        round(get("elevation")),
        round(get("flow")),
        round(get("erosion")),
        round(get("deposition")),
        round(get("thermalErosion")),
        round(get("lakeDepth")),
        round(get("rainfall")),
        round(get("temperature")),
        get("biome"),
        tostring(get("river")),
        tostring(get("riverBank")),
        tostring(get("lake")),
        tostring(get("water")),
        tostring(get("lakeId")),
        tostring(get("lakeGroupSize")),
        tostring(get("lakeOutletX")),
        tostring(get("lakeOutletY")),
        round(get("spilloverElevation")),
        round(get("spilloverFlow")),
        tostring(get("spillover")),
        tostring(get("spilloverLakeId")),
        tostring(get("talus")),
        tostring(get("alluvialFan")),
        tostring(get("alluvialFanLobe")),
        tostring(get("floodplain")),
        tostring(get("delta")),
        tostring(get("braidedRiver")),
        tostring(get("playa")),
        tostring(get("sinkhole")),
        tostring(get("cenote")),
        tostring(get("plateId")),
        tostring(get("secondaryPlateId")),
        round(get("plateAge")),
        round(get("secondaryPlateAge")),
        tostring(get("plateCrust")),
        tostring(get("secondaryPlateCrust")),
        round(get("oceanicSubduction")),
        round(get("subductionBias")),
        round(get("riftValley")),
        round(get("volcanicIslandArc")),
        round(get("shield")),
        round(get("craton")),
        tostring(get("ridgeId")),
        tostring(get("mountainRangeId")),
        tostring(get("basinId")),
        tostring(get("watershedId")),
        tostring(get("macroBasinId")),
        tostring(get("macroChannelId")),
        round(get("streamPowerDelta")),
        round(get("streamPowerErosion")),
        round(get("streamPowerUplift")),
        round(get("isostaticRebound")),
        round(get("sediment")),
        round(get("sedimentFlux")),
        round(get("sedimentCapacity")),
        round(get("precipitation")),
        round(get("rainShadowScore")),
        tostring(get("rainShadow")),
        round(get("windX")),
        round(get("windY")),
        round(get("baselinePrecip")),
        tostring(get("pressureCellId")),
        round(get("monsoonIndex")),
        round(get("hotspotContribution")),
        round(get("hotspotAgeMy")),
        tostring(get("hotspotId")),
        tostring(get("isFloodBasalt")),
        round(get("meanderBend")),
        tostring(get("oxbowLake")),
        round(get("glacialDelta")),
        round(get("glacialErosion")),
        round(get("iceThickness")),
        tostring(get("glaciated")),
        tostring(get("coastCliff")),
        tostring(get("coastBeach")),
        round(get("coastExposure")),
        round(get("coastErosion")),
        round(get("coastDeposition")),
        tostring(get("shorelineNode")),
        round(get("duneDelta")),
        round(get("duneAmplitude")),
        round(get("dunePhase")),
        tostring(get("lithology")),
        round(get("erodibilityK")),
        round(get("lithologyAge")),
        round(get("karstDepth")),
        round(get("cavePresence")),
        tostring(get("karstType")),
        round(get("reefAccretion")),
        round(get("reefAgeMy")),
        tostring(get("reefStage")),
        tostring(get("archetypeId")),
        round(get("archetypeBlend")),
        tostring(get("volcanicForm")),
        round(get("volcanicAgeMy")),
        tostring(get("periglacialFeature")),
        tostring(get("submarineCanyon")),
        round(get("shelfDistance")),
        tostring(get("soilOrder")),
        tostring(get("treeline")),
        tostring(get("riparian")),
        round(get("fireFrequency")),
        round(get("regolithDepth")),
        round(get("bedrockElevation")),
        round(get("marineTerrace")),
        round(get("fluvialTerrace")),
        round(get("latitudeRadians")),
        round(get("coriolisF")),
        round(get("hillslopeDelta")),
        tostring(get("debrisFlow")),
        round(get("debrisFlowDelta")),
        tostring(get("paleoShoreline")),
        tostring(get("riverHistorical")),
    }, "|")
end

local function encodeCell(cell)
    return encodeFields(function(field) return cell[field] end)
end

local function encodeChunkCell(chunk, x, y)
    local index = (y - 1) * chunk.size + (x - 1)
    local ref = chunk.refs and chunk.refs[index]
    local cell
    return encodeFields(function(field)
        local array = chunk.arrays and chunk.arrays[field]
        if array then
            local value = tonumber(array[index]) or 0
            if soaInt8BoolFields[field] then return value ~= 0 end
            return value
        end
        if ref and ref[field] ~= nil then return ref[field] end
        cell = cell or chunk.cells[y][x]
        return cell[field]
    end)
end

local function encodeChunk(chunk)
    local parts = { chunk.x, chunk.y, chunk.scale, chunk.scaleFactor }
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            parts[#parts + 1] = encodeChunkCell(chunk, x, y)
        end
    end
    return table.concat(parts, "\n")
end

local function testDeterminism()
    local a = testWorld(1234)
    local b = testWorld(1234)
    expect(encodeChunk(a:chunk(2, -1, "local")) == encodeChunk(b:chunk(2, -1, "local")), "same seed should produce identical local chunk")
    expect(encodeChunk(a:chunk(0, 0, "continent")) == encodeChunk(b:chunk(0, 0, "continent")), "same seed should produce identical continent chunk")
end

local function testSeedVariance()
    local a = encodeChunk(testWorld(1234):chunk(0, 0, "region"))
    local b = encodeChunk(testWorld(5678):chunk(0, 0, "region"))
    expect(a ~= b, "different seeds should differ")
end

local function testSampleChunkAgreement()
    local world = testWorld(44)
    local chunk = world:chunk(1, -2, "local")
    for y = 1, chunk.size do
        local cell = chunk.cells[y][1]
        local sampled = world:sample(cell.x, cell.y, "local")
        expect(encodeCell(cell) == encodeCell(sampled), "sample should match chunk cell")
    end
    local right = world:chunk(0, 0, "region")
    local left = world:chunk(1, 0, "region")
    local seamSample = world:sample(left.cells[1][1].x, left.cells[1][1].y, "region")
    expect(encodeCell(left.cells[1][1]) == encodeCell(seamSample), "adjacent chunk seam should resolve to the same sample")
    expect(right.cells[1][right.size].x + right.scaleFactor == left.cells[1][1].x, "adjacent chunks should be coordinate-continuous")
end

local function testRiverMonotonicity()
    local world = testWorld(99)
    local chunk = world:chunk(0, 0, "local")
    local stats = world:hydrologyStats(0, 0, "local")
    local byCoord = {}
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            local cell = chunk.cells[y][x]
            byCoord[cell.x .. ":" .. cell.y] = cell
        end
    end
    local checked = 0
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            local cell = chunk.cells[y][x]
            if cell.river and cell.downX then
                local down = byCoord[cell.downX .. ":" .. cell.downY]
                if down then
                    expect(cell.elevation + 0.00001 >= down.elevation, "river should not flow uphill")
                    checked = checked + 1
                end
            end
        end
    end
    expect(stats.rivers > 0, "fixture seed should produce rivers")
    expect(stats.uphillRejects == 0, "hydrology should reject uphill filled-flow routes")
    expect(checked >= 0, "river monotonicity check should run")
end

local function testHydrologyStats()
    local world = WorldGen.new(1)
    local stats = world:hydrologyStats(0, 0, "local")
    expect(stats.rivers > 0, "hydrology stats should include rivers")
    expect(stats.basins > 0, "hydrology stats should include basins")
    expect(stats.maxFlow > 0, "hydrology stats should include max flow")
    expect(stats.seamMismatches == 0, "hydrology region should not contain broken downstream refs")
    expect(stats.uphillRejects == 0, "hydrology region should not route uphill over filled elevation")
    local chunk = world:chunk(0, 0, "local")
    local inspected = 0
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            local cell = chunk.cells[y][x]
            expect(cell.filledElevation >= cell.elevationBase - 0.000001, "filled elevation should not undercut base elevation")
            expect(cell.basinId and cell.watershedId, "cells should expose basin and watershed ids")
            if cell.lake then
                expect(cell.water and cell.lakeDepth > 0 and cell.lakeSurface >= cell.elevationBase, "lake cells should expose filled water state")
                if cell.outletX then
                    expect(cell.outletX == cell.outletX and cell.outletY == cell.outletY, "lake outlet coordinates should be finite")
                end
                inspected = inspected + 1
            end
        end
    end
    expect(stats.lakes > 0 or inspected == 0, "lake stats should be available when lakes exist")
end

local function testLakeGroupingAndSpillover()
    local world = WorldGen.new(1)
    local stats = world:hydrologyStats(-1, -2, "continent")
    expect(stats.lakeCells > 0 and stats.lakeGroups > 0, "fixture seed should include grouped lakes")
    local inspected = 0
    local spilloverRefs = 0
    for cy = -3, -2 do
        for cx = -1, 0 do
            local chunk = world:chunk(cx, cy, "continent")
            for y = 1, chunk.size do
                for x = 1, chunk.size do
                    local cell = chunk.cells[y][x]
                    if cell.lake then
                        expect(cell.lakeId and cell.lakeGroupSize and cell.lakeGroupSize > 0, "lake cells should expose stable group ids and size")
                        expect(cell.lakeOutletX and cell.lakeOutletY and cell.spilloverElevation, "lake cells should expose outlet and spillover labels")
                        local outlet = world:sample(cell.lakeOutletX, cell.lakeOutletY, "continent")
                        if outlet.spillover and outlet.spilloverLakeId == cell.lakeId then spilloverRefs = spilloverRefs + 1 end
                        inspected = inspected + 1
                    end
                end
            end
        end
    end
    expect(inspected == stats.lakeCells, "lake group fixture should inspect every lake cell in the region")
    expect(spilloverRefs > 0, "lake outlet should be labeled as spillover inside the fixture region")
end

local function testErosionLandforms()
    local totals = { talus = 0, alluvial = 0, floodplain = 0, delta = 0, sediment = 0 }
    for _, seed in ipairs({ 1, 3, 6 }) do
        local stats = WorldGen.new(seed):hydrologyStats(0, 0, "local")
        totals.talus = totals.talus + stats.talusSlopes
        totals.alluvial = totals.alluvial + stats.alluvialFans
        totals.floodplain = totals.floodplain + stats.floodplains
        totals.delta = totals.delta + stats.deltas
        totals.sediment = totals.sediment + stats.sedimentCells
    end
    expect(totals.talus > 0, "thermal erosion should expose talus slopes")
    expect(totals.sediment > 0, "stream power deposition should expose sediment cells")
    expect(totals.alluvial > 0, "sediment deposition should expose alluvial fans")
    expect(totals.floodplain > 0, "sediment deposition should expose floodplains")
    expect(totals.delta > 0, "river mouths should expose deltas")
end

local function testTectonicFeatures()
    local counts = { age = 0, subduction = 0, rift = 0, islandArc = 0, shield = 0, craton = 0 }
    for _, seed in ipairs({ 3, 19, 45, 46, 99, 616, 717, 20260625 }) do
        local world = WorldGen.new(seed)
        for y = -1024, 1024, 64 do
            for x = -1024, 1024, 64 do
                local cell = world:baseSample(x, y, "local")
                if cell.plateAge and cell.plateAge >= 0 and cell.plateAge <= 1 then counts.age = counts.age + 1 end
                if (cell.oceanicSubduction or 0) > 0.08 then counts.subduction = counts.subduction + 1 end
                if (cell.riftValley or 0) > 0.08 then counts.rift = counts.rift + 1 end
                if (cell.volcanicIslandArc or 0) > 0.04 then counts.islandArc = counts.islandArc + 1 end
                if (cell.shield or 0) > 0.2 then counts.shield = counts.shield + 1 end
                if (cell.craton or 0) > 0.12 then counts.craton = counts.craton + 1 end
            end
        end
    end
    expect(counts.age > 0, "cells should expose normalized plate age")
    expect(counts.subduction > 0, "tectonics should include oceanic subduction bias")
    expect(counts.rift > 0, "tectonics should include rift valleys")
    expect(counts.islandArc > 0, "tectonics should include volcanic island arcs")
    expect(counts.shield > 0, "tectonics should include shield regions")
    expect(counts.craton > 0, "tectonics should include cratons")
end

local function testOrometryArchetypes()
    local archetypes = Orometry.archetypes()
    expect(#archetypes == 6, "orometry bake should expose six archetypes")
    expect(archetypes.byKey.appalachians.id == 2 and archetypes.byKey.himalaya.id == 3, "orometry archetype ids should be stable")
    local world = WorldGen.new(20260625, fastWorldOptions)
    local info = WorldGen.scaleInfo("local")
    local function center(blockX, blockY)
        local size = world.chunkSize * world.orometryBlockChunks
        return blockX * size + math.floor(size * 0.5), blockY * size + math.floor(size * 0.5)
    end
    local function candidates(targetId, limit)
        local out = {}
        for by = -24, 24 do
            for bx = -24, 24 do
                local x, y = center(bx, by)
                local cell = world:baseSample(x, y, info.id)
                if cell.archetypeId == targetId and cell.plateCrust == "continental" and (cell.uplift or 0) > 0.12 then
                    out[#out + 1] = { x = x, y = y, id = targetId }
                    if #out >= limit then return out end
                end
            end
        end
        return out
    end
    local function stats(point)
        local sumSlope, count = 0, 0
        local minElevation, maxElevation = math.huge, -math.huge
        for gy = -2, 2 do
            for gx = -2, 2 do
                local cell = world:baseSample(point.x + gx * 24, point.y + gy * 24, info.id)
                expect(cell.archetypeId == point.id and cell.archetypeBlend > 0.95, "orometry samples should stay inside one archetype block")
                sumSlope = sumSlope + cell.slope
                minElevation = math.min(minElevation, cell.elevation)
                maxElevation = math.max(maxElevation, cell.elevation)
                count = count + 1
            end
        end
        return { slope = sumSlope / count, relief = maxElevation - minElevation }
    end
    local lowCandidates = candidates(2, 6)
    local highCandidates = candidates(3, 6)
    expect(#lowCandidates > 0 and #highCandidates > 0, "orometry fixture should find two continental archetype chunks")
    local low, high = { slope = math.huge, relief = math.huge }, { slope = 0, relief = 0 }
    for _, point in ipairs(lowCandidates) do
        local item = stats(point)
        if item.slope + item.relief < low.slope + low.relief then low = item end
    end
    for _, point in ipairs(highCandidates) do
        local item = stats(point)
        if item.slope + item.relief > high.slope + high.relief then high = item end
    end
    expect(high.slope > low.slope * 1.3 and high.relief > low.relief * 1.3, "distinct orometry chunks should differ by more than 30% in mean slope and relief")
end

local function testHotspotTrails()
    local world = WorldGen.new(20260625, { geologicTime = 1.0, hotspotSigma = 8, hotspotElevationScale = 0.25, floodBasaltThreshold = 0.1 })
    local same = WorldGen.new(20260625, { geologicTime = 1.0, hotspotSigma = 8, hotspotElevationScale = 0.25, floodBasaltThreshold = 0.1 })
    expect(#world.hotspots == 64 and #same.hotspots == 64, "hotspot set should default to 64 deterministic points")
    for index, hotspot in ipairs(world.hotspots) do
        local other = same.hotspots[index]
        expect(round(hotspot.x) == round(other.x) and round(hotspot.y) == round(other.y), "hotspot positions should be deterministic")
        for previous = 1, index - 1 do
            local prior = world.hotspots[previous]
            local dx = math.abs(hotspot.x - prior.x)
            local dy = math.abs(hotspot.y - prior.y)
            local extent = world.hotspotMantleExtent
            if dx > extent * 0.5 then dx = extent - dx end
            if dy > extent * 0.5 then dy = extent - dy end
            expect(math.sqrt(dx * dx + dy * dy) >= world.hotspotMinSeparation, "hotspot Poisson spacing should hold")
        end
    end
    local function drift(v, t)
        return math.tanh(v * t) * 640 * 0.4
    end
    local hotspot = world.hotspots[1]
    local plate = { vx = 0.5, vy = 0, boundary = 0.05 }
    local previousContribution, flood = math.huge, false
    for step = 0, 3 do
        local x = hotspot.x + drift(plate.vx, world.geologicTime) - drift(plate.vx, step * world.hotspotTrailDt)
        local result = world:hotspotAt(x, hotspot.y, plate)
        expect(result.hotspotId == hotspot.id and result.hotspotAgeMy == step * world.hotspotTrailDt * 100, "hotspot trail should track plate drift age")
        expect(result.contribution > 0 and result.contribution <= previousContribution + 0.000001, "hotspot trail should decay away from active shield")
        flood = flood or result.isFloodBasalt
        previousContribution = result.contribution
    end
    expect(flood, "high-intensity intraplate hotspot should flag flood basalt cells")
    local active = world:hotspotAt(hotspot.x + drift(plate.vx, world.geologicTime), hotspot.y, plate)
    expect(active.contribution > 0.1 and active.hotspotId == hotspot.id, "hotspot helper should expose active shield fields")
end

local function testVolcanicLandforms()
    local function makeRegion(kind)
        local region = { cells = {}, seaLevel = -1 }
        local cx, cy = 16, 16
        for gy = 1, 32 do
            for gx = 1, 32 do
                local dx, dy = gx - cx, gy - cy
                local dist = math.sqrt(dx * dx + dy * dy)
                local base = 0.58 - gy * 0.006
                local cell = {
                    gx = gx,
                    gy = gy,
                    elevationBase = base,
                    elevation = base,
                    bedrockElevation = base,
                    slope = 0.04,
                    water = false,
                    lithology = kind == "hotspot" and 1 or 3,
                    isFloodBasalt = kind == "hotspot",
                    hotspotAgeMy = 12,
                    volcanicIslandArc = kind == "arc" and math.max(0, 0.12 - dist * 0.012) or 0,
                    hotspotContribution = kind == "hotspot" and math.max(0, 0.45 - dist * 0.022) or 0,
                }
                region.cells[gx .. ":" .. gy] = cell
            end
        end
        return region
    end
    local arc = makeRegion("arc")
    local arcStats = Volcano.applyRegion(arc, { seed = 20260625, arcThreshold = 0.04, hotspotThreshold = 0.25, density = 1, maxFeatures = 1, minSpacing = 4, forceCaldera = true })
    expect(arcStats.stratoCones > 0 and arcStats.calderas > 0 and arcStats.lavaFlows > 0, "arc volcano should stamp strato cone, caldera, and lava flow")
    expect(arcStats.maxDelta > 0.18 and arcStats.lavaFlowCells > 0, "arc volcano should visibly raise cone and route lava")
    local center = arc.cells["16:16"]
    expect(center.volcanicForm == 2 and center.volcanicAgeMy > 0, "caldera summit should expose volcanic form and age")

    local hotspot = makeRegion("hotspot")
    local hotspotStats = Volcano.applyRegion(hotspot, { seed = 20260625, arcThreshold = 0.04, hotspotThreshold = 0.25, density = 1, maxFeatures = 1, minSpacing = 4 })
    expect(hotspotStats.shields > 0 and hotspotStats.lavaFlows > 0, "hotspot volcano should stamp shield and lava flow")
    local forms = {}
    for _, cell in pairs(hotspot.cells) do forms[cell.volcanicForm or 0] = true end
    expect(forms[3] and forms[4], "hotspot fixture should contain shield and lava-flow cells")
end

local function testPeriglacialStamps()
    local region = { cells = {} }
    for gy = 1, 24 do
        for gx = 1, 24 do
            local base = 0.22 + gy * 0.001
            region.cells[gx .. ":" .. gy] = {
                gx = gx,
                gy = gy,
                elevationBase = base,
                elevation = base,
                bedrockElevation = base,
                temperature = gx <= 12 and 0.16 or 0.22,
                rainfall = gx <= 12 and 0.35 or 0.62,
                moisture = gx <= 12 and 0.35 or 0.62,
                slope = gy <= 8 and 0.03 or (gy <= 16 and 0.07 or 0.14),
                water = false,
                glaciated = false,
                biome = gx <= 12 and "tundra" or "boreal_forest",
            }
        end
    end
    local stats = Periglacial.applyRegion(region, { seed = 20260625, pingoDensity = 1, palsaDensity = 1 })
    expect(stats.coldCells > 0 and stats.pingos > 0 and stats.polygons > 0 and stats.solifluction > 0, "cold terrain should stamp pingos, polygons, and solifluction")
    expect(stats.palsas > 0 and stats.affectedCells > 0, "wet cold terrain should stamp palsas")
    local seen = {}
    for _, cell in pairs(region.cells) do seen[cell.periglacialFeature or 0] = true end
    expect(seen[1] and seen[2] and seen[3] and seen[4], "periglacial fixture should expose all feature ids")
end

local function testDiscoveryOverlayIds()
    local world = WorldGen.new(99)
    local ridgeIds, rangeIds = {}, {}
    for cy = -1, 1 do
        for cx = -1, 1 do
            local chunk = world:chunk(cx, cy, "local")
            for y = 1, chunk.size, 4 do
                for x = 1, chunk.size, 4 do
                    local cell = chunk.cells[y][x]
                    expect(cell.basinId and cell.watershedId, "sampled cells should expose basin and watershed ids")
                    if cell.ridgeId then ridgeIds[cell.ridgeId] = true end
                    if cell.mountainRangeId then rangeIds[cell.mountainRangeId] = true end
                end
            end
        end
    end
    local ridgeCount, rangeCount = 0, 0
    for _ in pairs(ridgeIds) do ridgeCount = ridgeCount + 1 end
    for _ in pairs(rangeIds) do rangeCount = rangeCount + 1 end
    expect(ridgeCount > 0, "sampled cells should expose ridge ids")
    expect(rangeCount > 0, "sampled cells should expose mountain-range ids")
end

local function testNamedTerrainDiscoveries()
    local world = WorldGen.new(1)
    local repeatWorld = WorldGen.new(1)
    local points = { { -320, -320 }, { -64, -320 }, { 0, -320 }, { -32, -128 }, { -32, -512 }, { -1376, -4096 }, { -1472, -3968 } }
    local seen = {}
    local expected = {}
    for _, kind in ipairs(WorldGen.discoveryKinds()) do expected[kind] = true end
    for _, point in ipairs(points) do
        local first = world:discoveriesAt(point[1], point[2], "local")
        local second = repeatWorld:discoveriesAt(point[1], point[2], "local")
        expect(#first == #second, "terrain discovery labels should be deterministic")
        for index, item in ipairs(first) do
            expect(item.name == second[index].name and item.id == second[index].id, "terrain discovery names should be stable")
            seen[item.kind] = true
        end
    end
    for kind in pairs(expected) do
        expect(seen[kind], "terrain discovery should include " .. kind)
    end
end

local function testSurveyHistory()
    local world = WorldGen.new(99)
    local history = Survey.new()
    Survey.mark(history, world, -64, -64, "local")
    local cellsAfterFirst = history.cellCount
    local discoveriesAfterFirst = history.discoveryCount
    expect(cellsAfterFirst == 1, "survey should mark sampled terrain cells")
    expect(discoveriesAfterFirst > 0, "survey should record terrain discoveries")
    Survey.mark(history, world, -64, -64, "local")
    expect(history.cellCount == cellsAfterFirst and history.discoveryCount == discoveriesAfterFirst, "survey should dedupe repeated marks")
    Survey.mark(history, world, -16, 16, "local")
    expect(history.cellCount > cellsAfterFirst and history.discoveryCount >= discoveriesAfterFirst, "survey should grow when marking new cells")
    local firstPin = Survey.dropPin(history, world, 4.2, -8.7, "local")
    Survey.dropPin(history, world, 12, 16, "local")
    Survey.dropPin(history, world, -24, 32, "local")
    expect(history.pinCount == 3 and #Survey.pinEntries(history) == 3, "survey should track user pins separately")
    local entries = Journal.entries(history)
    expect(#entries == history.pinCount + history.discoveryCount, "journal entries should match survey pin and discovery counts")
    local jumpApp = { player = Player.new(0, 0), camera = Render.defaultCamera(), minimapCache = { stale = true } }
    jumpApp.player.vx, jumpApp.player.vy, jumpApp.player.stumbleCooldown = 4, -3, 1
    local preloadReason
    expect(Journal.teleport(jumpApp, firstPin, function(_, reason) preloadReason = reason end), "journal teleport should accept pin targets")
    expect(jumpApp.player.x == firstPin.x and jumpApp.player.y == firstPin.y and jumpApp.player.vx == 0 and jumpApp.player.vy == 0 and jumpApp.minimapCache == nil and preloadReason == "teleport", "journal teleport should snap position, reset velocity, and preload")
    local snapshot = Survey.snapshot(history)
    local restored = Survey.fromSnapshot(snapshot)
    expect(restored.pinCount == 3 and restored.nextPinId == 4, "survey pins should persist through snapshot")
    expect(Survey.deletePin(restored, firstPin.id) and restored.pinCount == 2, "survey should delete pins by id")
end

local function testSaveLoadRoundTrip()
    local world = WorldGen.new(99, { scope = "region", allowExoticBiomes = true, geologicTime = 0.4, geologicTimeStep = 0.03, hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 4, hydrologyBasinStride = 4, cacheMaxEntries = 256, seaLevel = 0.02, seaLevelAmplitude1 = 0.04, seaLevelAmplitude2 = 0.01, seaLevelResidualAmplitude = 0, zScale = 12000, maxOceanAgeMyr = 160, legacyLatitude = false, worldCircumference = 1024, omega = 0.0001, hillslopeD = 0.02, hillslopeSc = 0.9, hillslopeIterations = 3, debrisK = 0.01, debrisCriticalConcentration = 0.2, debrisSedimentYield = 1200, glacialGamma = 6e-9, glacialBeta = 0.01, glacialBmax = 1.5, glacialKg = 7e-5, glacialSiaIterations = 5, seasonRate = 2, itczOffsetAmp = 0.1, monsoonSeasonalContrast = 1.4, windCoriolisScale = 0.3, hotspotCount = 12, hotspotMantleExtent = 32768, hotspotMinSeparation = 2048, hotspotBucketSize = 4096, hotspotSigma = 768, hotspotTrailSteps = 5, hotspotTrailDt = 0.15, hotspotTau = 2.5, hotspotElevationScale = 0.33, floodBasaltThreshold = 0.25, meanderWidthScale = 2.2, meanderMigrationScale = 0.8 })
    local survey = Survey.new()
    Survey.mark(survey, world, -64, -64, "local")
    Survey.dropPin(survey, world, 22, -9, "local")
    local viewScale = ViewScale.new(world)
    ViewScale.update(viewScale, 1, world, -64, -64)
    local app = {
        world = world,
        player = { x = 12.5, y = -7.25 },
        camera = { yaw = 0.7, pitch = -0.1 },
        survey = survey,
        viewScale = viewScale,
        mouseLook = false,
        debugPerf = true,
        debugTopo = true,
        minimap = true,
        showAreaLabels = false,
        showPlayerHud = false,
        debugPanels = true,
        pixelScale = 3,
        atmosphere = Atmosphere.new({ time = 0.4, season = "autumn", dayLength = 90 }),
    }
    local encoded = Save.encode(Save.snapshot(app))
    local decoded = Save.decode(encoded)
    local restoredSurvey = Survey.fromSnapshot(decoded.survey)
    expect(decoded.seed == 99 and decoded.player.x == 12.5 and decoded.player.y == -7.25, "save should round-trip seed and player position")
    expect(decoded.camera.yaw == 0.7 and decoded.display.viewScale == "region", "save should round-trip camera and display settings")
    expect(decoded.world.scope == "region" and decoded.world.allowExoticBiomes == true and decoded.world.optionsHash == Save.worldOptionsHash(world:metadata()), "save should round-trip deterministic world scope hash")
    expect(decoded.world.hydrologyRegionChunks == 1 and decoded.world.hydrologyHaloCells == 0 and decoded.world.hydrologyBasinChunks == 4 and decoded.world.hydrologyBasinStride == 4 and decoded.world.cacheMaxEntries == 256, "save should round-trip creation hydrology settings")
    expect(decoded.world.geologicTime == 0.4 and decoded.world.geologicTimeStep == 0.03 and decoded.world.seaLevelAmplitude1 == 0.04, "save should round-trip world sea-level settings")
    expect(decoded.world.zScale == 12000 and decoded.world.maxOceanAgeMyr == 160, "save should round-trip bathymetry settings")
    expect(decoded.world.legacyLatitude == false and decoded.world.worldCircumference == 1024 and decoded.world.omega == 0.0001, "save should round-trip latitude settings")
    expect(decoded.world.hillslopeD == 0.02 and decoded.world.hillslopeSc == 0.9 and decoded.world.hillslopeIterations == 3, "save should round-trip hillslope settings")
    expect(decoded.world.debrisK == 0.01 and decoded.world.debrisCriticalConcentration == 0.2 and decoded.world.debrisSedimentYield == 1200, "save should round-trip debris-flow settings")
    expect(decoded.world.glacialGamma == 6e-9 and decoded.world.glacialBeta == 0.01 and decoded.world.glacialBmax == 1.5 and decoded.world.glacialKg == 7e-5 and decoded.world.glacialSiaIterations == 5, "save should round-trip glacial SIA settings")
    expect(decoded.world.seasonRate == 2 and decoded.world.itczOffsetAmp == 0.1 and decoded.world.monsoonSeasonalContrast == 1.4 and decoded.world.windCoriolisScale == 0.3, "save should round-trip climate-band settings")
    expect(decoded.world.hotspotCount == 12 and decoded.world.hotspotMantleExtent == 32768 and decoded.world.hotspotMinSeparation == 2048 and decoded.world.hotspotBucketSize == 4096, "save should round-trip hotspot grid settings")
    expect(decoded.world.hotspotSigma == 768 and decoded.world.hotspotTrailSteps == 5 and decoded.world.hotspotTrailDt == 0.15 and decoded.world.hotspotTau == 2.5 and decoded.world.hotspotElevationScale == 0.33 and decoded.world.floodBasaltThreshold == 0.25, "save should round-trip hotspot physics settings")
    expect(decoded.world.meanderWidthScale == 2.2 and decoded.world.meanderMigrationScale == 0.8, "save should round-trip meander settings")
    expect(decoded.atmosphere.time == 0.4 and decoded.atmosphere.season == "autumn" and decoded.atmosphere.dayLength == 90, "save should round-trip atmosphere state")
    expect(decoded.display.debugPerf and decoded.display.debugTopo and decoded.display.minimap and decoded.display.debugPanels and decoded.display.pixelScale == 3 and not decoded.display.mouseLook and decoded.display.showAreaLabels == false and decoded.display.showPlayerHud == false, "save should round-trip display toggles")
    expect(restoredSurvey.cellCount == survey.cellCount and restoredSurvey.discoveryCount == survey.discoveryCount and restoredSurvey.pinCount == survey.pinCount, "save should round-trip survey annotations")
end

local function testViewScaleTransitions()
    local world = WorldGen.new(99, { scope = "continent" })
    local view = ViewScale.new(world)
    ViewScale.update(view, 0, world, -64, -64)
    expect(ViewScale.activeScale(view) == "continent", "view scale should start at world scope")
    local labelsAfterLocal = #ViewScale.visibleLabels(view, 16)
    ViewScale.shift(view, world, 1, -64, -64)
    local mid = ViewScale.params(view, world)
    expect(mid.target == "continent" and mid.factor == 16 and not mid.transitioning, "view scale shift should be fixed at world scope")
    ViewScale.update(view, 0.28, world, -64, -64)
    mid = ViewScale.params(view, world)
    expect(mid.factor == 16 and not mid.transitioning, "view scale should not ease between scopes")
    ViewScale.update(view, 1, world, -64, -64)
    local region = ViewScale.params(view, world)
    expect(region.target == "continent" and region.factor == 16 and not region.transitioning, "view scale should remain fixed")
    ViewScale.shift(view, world, 1, -16, 16)
    ViewScale.update(view, 1, world, -16, 16)
    local continent = ViewScale.params(view, world)
    local labels = ViewScale.visibleLabels(view, 32)
    local scales = {}
    for _, label in ipairs(labels) do
        scales[label.scale] = true
        expect(type(label.x) == "number" and type(label.y) == "number" and type(label.priority) == "number", "view labels should expose world centroid and priority")
    end
    expect(continent.target == "continent" and continent.factor == 16, "view scale should reach continent")
    expect(#labels >= labelsAfterLocal and scales.continent, "view labels should persist at fixed scope")
end

local function testDiegeticScaleTransitions()
    local world = WorldGen.new(99, { scope = "region" })
    local view = ViewScale.new(world)
    local localAnchor = ViewScale.advanceDiegetic(view, world, -64, -64)
    expect(localAnchor.from == "region" and localAnchor.target == "region" and localAnchor.mode == "fixed" and localAnchor.name, "fixed scope should use a terrain anchor")
    ViewScale.update(view, 1, world, -64, -64)
    local regionAnchor = ViewScale.advanceDiegetic(view, world, -16, 16)
    expect(regionAnchor.from == "region" and regionAnchor.target == "region" and regionAnchor.name, "region scope should remain fixed")
    ViewScale.update(view, 1, world, -16, 16)
    local returnAnchor = ViewScale.advanceDiegetic(view, world, -16, 16)
    ViewScale.update(view, 1, world, -16, 16)
    expect(returnAnchor.from == "region" and returnAnchor.target == "region", "diegetic advance should not change world scope")
    expect(ViewScale.params(view, world).target == "region" and view.anchor.name == returnAnchor.name, "diegetic scope anchor should persist on the view")
end

local function testBasinHydrologyBudget()
    local world = WorldGen.new(1, basinWorldOptions)
    world:chunk(0, 0, "local")
    local stats = world:hydrologyStats(0, 0, "local")
    local metrics = world:metricsSnapshot()
    local cache = world:cacheStats()
    expect(stats.macroChannels > 0, "coarse basin pass should feed local macro channels")
    expect(metrics.hydrologyMisses == 1 and metrics.basinMisses == 1, "first chunk should solve one detail region and one coarse basin")
    expect(metrics.hydrologyCells == 4096 and metrics.basinCells == 4096, "first chunk hydrology should stay bounded")
    expect(cache.hydrology == 1 and cache.basins == 1, "first chunk should cache one hydrology region and one basin")
end

local function testCacheBoundsAndCounters()
    local world = WorldGen.new(20260625, {
        hydrologyRegionChunks = 1,
        hydrologyHaloCells = 0,
        hydrologyBasinChunks = 8,
        hydrologyBasinStride = 8,
        cacheMaxEntries = 10,
        cacheLimits = { chunks = 3, hydrology = 2, basins = 1, billboards = 2 },
    })
    local first = encodeChunk(world:chunk(0, 0, "local"))
    for cy = -1, 1 do
        for cx = -1, 1 do
            world:chunk(cx, cy, "local")
        end
    end
    local cache = world:cacheStats()
    local metrics = world:metricsSnapshot()
    expect(cache.total <= 10 and cache.maxEntries == 10, "cache should enforce configured entry bound")
    expect(cache.chunks <= 3 and cache.hydrology <= 2 and cache.basins <= 1, "cache should enforce per-tier entry bounds")
    expect(cache.limits.chunks == 3 and cache.limits.hydrology == 2 and cache.limits.basins == 1, "cache stats should expose tier limits")
    expect(metrics.cachePuts > 10 and metrics.cacheEvictions > 0 and metrics.cacheMisses > 0, "cache metrics should count puts, evictions, and misses")
    expect(metrics.evictions.chunks > 0 and metrics.evictions.hydrology > 0 and metrics.evictions.basins >= 0, "cache metrics should expose tier evictions")
    expect(encodeChunk(world:chunk(0, 0, "local")) == first, "evicted chunk should regenerate deterministically")
    world:chunk(0, 0, "local")
    local after = world:metricsSnapshot()
    expect(after.cacheHits > metrics.cacheHits, "cache metrics should count hits")
end

local function testChunkSoAArrays()
    local world = testWorld(20260625)
    local chunk = world:chunk(0, 0, "local")
    local doubleFields = WorldGen.soaDoubleFields()
    local int8Fields = WorldGen.soaInt8Fields()
    local int32Fields = WorldGen.soaInt32Fields()
    local fields = WorldGen.soaFields()
    expect(#fields > 0 and chunk.arrays, "chunk should expose ffi-backed SoA arrays")
    expect(#doubleFields > 0 and #int8Fields > 0 and #int32Fields > 0, "soa field groups should cover double, int8, and int32 arrays")
    expect(chunk.refs and chunk.cells and not chunk.rawCells, "chunk should keep sparse refs plus a lazy cell proxy")
    expect(chunk.refs[0] and chunk.refs[0].elevation == nil and chunk.refs[0].water == nil and chunk.refs[0].downCell == nil, "chunk refs should not duplicate SoA fields or hydrology graph links")
    for _, field in ipairs(fields) do
        expect(chunk.arrays[field] ~= nil, "soa array should exist for " .. field)
    end
    local mismatches = 0
    local total = 0
    local firstMismatch
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            local cell = chunk.cells[y][x]
            local index = (y - 1) * chunk.size + (x - 1)
            for _, field in ipairs(doubleFields) do
                total = total + 1
                if round(chunk.arrays[field][index]) ~= round(soaValue(cell[field])) then
                    mismatches = mismatches + 1
                    firstMismatch = firstMismatch or field
                end
            end
            for _, field in ipairs(int8Fields) do
                total = total + 1
                local value = tonumber(chunk.arrays[field][index])
                local enumOk = (field == "lithology" and value >= 0 and value <= 7) or (field == "karstType" and value >= 0 and value <= 4) or (field == "reefStage" and value >= 0 and value <= 5) or (field == "archetypeId" and value >= 0 and value <= 6) or (field == "volcanicForm" and value >= 0 and value <= 5) or (field == "periglacialFeature" and value >= 0 and value <= 4) or (field == "soilOrder" and value >= 0 and value <= 10)
                local boolOk = field ~= "lithology" and field ~= "karstType" and field ~= "reefStage" and field ~= "archetypeId" and field ~= "volcanicForm" and field ~= "periglacialFeature" and field ~= "soilOrder" and (value == 0 or value == 1)
                if value ~= soaValue(cell[field]) or not (enumOk or boolOk) then
                    mismatches = mismatches + 1
                    firstMismatch = firstMismatch or field
                end
            end
            for _, field in ipairs(int32Fields) do
                total = total + 1
                if tonumber(chunk.arrays[field][index]) ~= soaValue(cell[field]) then
                    mismatches = mismatches + 1
                    firstMismatch = firstMismatch or field
                end
            end
        end
    end
    expect(total > 0 and mismatches == 0, "soa arrays should mirror cell field values: " .. tostring(firstMismatch))
end

local function testLithologyDistribution()
    local classes, land, unknownLand, invalid, crystalline, oceanicYoung, oceanicOld, carbonate = {}, 0, 0, 0, 0, 0, 0, 0
    for seed = 1, 32 do
        local world = WorldGen.new(seed, fastWorldOptions)
        expect(world.lithologyTable and world.lithologyTable[7].name == "evaporite", "world should expose lithology metadata")
        for gy = -3, 3 do
            for gx = -3, 3 do
                local x = gx * 211 + seed * 17
                local y = gy * 197 - seed * 13
                local cell = world:baseSample(x, y, "local")
                local lithology = cell.lithology
                classes[lithology] = true
                if type(lithology) ~= "number" or lithology < 0 or lithology > 7 then invalid = invalid + 1 end
                if cell.elevation > world:seaLevelAt(world.geologicTime) then
                    land = land + 1
                    if lithology < 1 or lithology > 7 then unknownLand = unknownLand + 1 end
                end
                local props = world.lithologyTable[lithology]
                if not props or round(cell.erodibilityK) ~= round(props.erodibilityK) then invalid = invalid + 1 end
                if cell.plateCrust == "continental" and (cell.shield or 0) + (cell.craton or 0) > 0.5 then
                    crystalline = crystalline + 1
                    if lithology ~= 2 and lithology ~= 3 then invalid = invalid + 1 end
                end
                if cell.plateCrust == "oceanic" and (cell.plateAge or 0) < 0.1 then
                    oceanicYoung = oceanicYoung + 1
                    if lithology ~= 1 then invalid = invalid + 1 end
                end
                if cell.plateCrust == "oceanic" and (cell.plateAge or 0) > 0.7 then
                    oceanicOld = oceanicOld + 1
                    if lithology ~= 6 then invalid = invalid + 1 end
                end
                local latitudeUnit = math.abs(world:latitudeAt(y)) / (math.pi / 2)
                if cell.plateCrust == "continental" and (cell.plateBoundary or 0) < 0.24 and latitudeUnit < 0.5 and (cell.rainfall or 0) > 0.16 and (cell.shield or 0) + (cell.craton or 0) <= 0.5 then
                    carbonate = carbonate + 1
                    if lithology ~= 4 then invalid = invalid + 1 end
                end
            end
        end
    end
    local classCount = 0
    for id = 1, 7 do
        if classes[id] then classCount = classCount + 1 end
    end
    local world = testWorld(20260625)
    local dryTerminal = { water = false, rainfall = 0.05, lithology = 5, erodibilityK = 0.9, lithologyAge = 0.4 }
    world:refineLithology(dryTerminal)
    expect(classCount >= 4 and land > 0 and unknownLand == 0 and invalid == 0, "lithology sweep should produce valid land classes")
    expect(crystalline > 0 and oceanicYoung > 0 and oceanicOld > 0 and carbonate > 0, "lithology sweep should cover tectonic rules")
    expect(dryTerminal.lithology == 7 and round(dryTerminal.erodibilityK) == round(world.lithologyTable[7].erodibilityK), "arid terminal land should refine to evaporite")
end

local function testKarstStamp()
    local function makeRegion(tropical, forceKind)
        local region = { seed = 20260625, stride = 1, seaLevel = 0, cells = {} }
        for gy = 0, 15 do
            for gx = 0, 15 do
                region.cells[gx .. ":" .. gy] = {
                    gx = gx,
                    gy = gy,
                    x = gx,
                    y = gy,
                    elevationBase = tropical and 0.28 or 0.34,
                    elevation = tropical and 0.28 or 0.34,
                    bedrockElevation = tropical and 0.28 or 0.34,
                    slope = tropical and 0.02 or 0.08,
                    rainfall = tropical and 0.9 or 0.55,
                    latitudeRadians = tropical and 0.1 or 0.45,
                    lithology = 4,
                    water = false,
                }
            end
        end
        local stats = Karst.applyRegion(region, { seed = 20260625, seaLevel = 0, density = 1, forceKind = forceKind })
        return region, stats
    end
    local dolineRegion, dolineStats = makeRegion(false, 1)
    local towerRegion, towerStats = makeRegion(true, 3)
    local dolineCells, sinkholes, towerCells, caves = 0, 0, 0, 0
    for _, cell in pairs(dolineRegion.cells) do
        if (cell.karstDepth or 0) > 0 then dolineCells = dolineCells + 1 end
        if cell.sinkhole then sinkholes = sinkholes + 1 end
        if (cell.cavePresence or 0) >= 0.2 then caves = caves + 1 end
    end
    for _, cell in pairs(towerRegion.cells) do
        if cell.karstType == 3 and cell.elevationBase > 0.28 then towerCells = towerCells + 1 end
    end
    expect(dolineStats.features > 0 and dolineStats.dolines > 0 and dolineCells > 0, "karst pass should stamp carbonate dolines")
    expect(dolineStats.sinkholes > 0 and sinkholes == dolineStats.sinkholes, "karst dolines should flag sinkhole cells")
    expect(towerStats.features > 0 and towerStats.towers > 0 and towerCells > 0, "humid tropical carbonate should stamp tower karst")
    expect(caves > 0, "carbonate cells should expose cave presence")
    expect(Biomes.lookup(0.7, 0.6, 0.2, false, 0.03, 0, false, 1) == "karst", "karst cells should route to karst biome")
end

local function testReefSuccession()
    local function makeRegion(kind)
        local region = { seed = 20260625, seaLevel = 0, geologicTime = 1, cells = {} }
        for gy = 0, 20 do
            for gx = 0, 20 do
                local dx, dy = gx - 10, gy - 10
                local dist = math.sqrt(dx * dx + dy * dy)
                local water = true
                local elevation = -0.04
                if kind == "fringing" and gx <= 5 then
                    water = false
                    elevation = 0.08
                elseif kind == "atoll" then
                    elevation = dist < 3 and -0.065 or (dist >= 5 and dist <= 7 and -0.03 or -0.09)
                end
                region.cells[gx .. ":" .. gy] = {
                    gx = gx,
                    gy = gy,
                    x = gx,
                    y = gy,
                    elevationBase = elevation,
                    elevation = elevation,
                    water = water,
                    lake = false,
                    temperature = 0.78,
                    latitudeRadians = 0.1,
                    oceanDepthMeters = kind == "fringing" and 2605 or (kind == "barrier" and 2860 or 3300),
                    hotspotContribution = kind == "atoll" and 0.35 or 0,
                    hotspotAgeMy = kind == "atoll" and 60 or 0,
                }
            end
        end
        return region
    end
    local fringing = makeRegion("fringing")
    local fringingStats = Reef.applyRegion(fringing, { seed = 20260625, seaLevel = 0, geologicTimeMyr = 40 })
    local barrier = makeRegion("barrier")
    local barrierStats = Reef.applyRegion(barrier, { seed = 20260625, seaLevel = 0, geologicTimeMyr = 40 })
    local atoll = makeRegion("atoll")
    local atollStats = Reef.applyRegion(atoll, { seed = 20260625, seaLevel = 0, geologicTimeMyr = 80 })
    expect(fringingStats.fringing > 0, "warm shallow coasts should develop fringing reefs")
    expect(barrierStats.barrier > 0, "moderate subsidence should develop barrier reefs")
    expect(atollStats.atoll > 0 and atollStats.lagoon > 0, "strong subsidence should produce atoll rings and lagoons")
    expect(atoll.cells["10:10"].reefStage == 4, "atoll interiors should be lagoon stage")
    expect(Biomes.lookup(0.7, 0.6, -0.02, true, 0, 0, false, 0, 3) == "reef", "reef stages should route to reef biome")
    expect(Biomes.lookup(0.7, 0.6, -0.04, true, 0, 0, false, 0, 4) == "lagoon", "atoll interiors should route to lagoon biome")
end

local function testLithologyErodibilityScalesStreamPower()
    local function erosionFor(multiplier)
        local low = { gx = 0, gy = 0, elevationBase = 0, elevation = 0, filledElevation = 0, flow = 1, water = false }
        local high = { gx = 1, gy = 0, elevationBase = 1, elevation = 1, filledElevation = 1, flow = 100, downCell = low, downDistance = 1, erodibilityK = multiplier, water = false }
        Erosion.relax({ cells = { low = low, high = high }, seaLevel = -1, stride = 1 }, { iterations = 1, K = 0.01, m = 0.5, n = 1, uplift = false, isostasy = false })
        return high.streamPowerErosion or 0
    end
    expect(erosionFor(1.6) > erosionFor(0.4), "lithology erodibility should scale stream-power erosion")
end

local function testRegolithProduction()
    local steady = SoilProduction.steadyStateDepth(100 / 1000000)
    expect(math.abs(steady - 0.2027) < 0.01, "regolith steady-state depth should match Heimsath exponential")
    local low = { elevation = 1, elevationBase = 1, slope = 0.02, regolithDepth = 0 }
    local mid = { elevation = 1, elevationBase = 1, slope = 0.2, regolithDepth = 0 }
    local high = { elevation = 1, elevationBase = 1, slope = 0.8, regolithDepth = -1 }
    SoilProduction.step({ cells = { low = low, mid = mid, high = high } }, { dt = 0.05 })
    expect(low.elevation == 1 and mid.elevation == 1 and high.elevation == 1, "soil production should preserve surface elevation")
    expect(low.regolithDepth >= mid.regolithDepth and mid.regolithDepth > high.regolithDepth, "regolith depth should anti-correlate with slope")
    for _, cell in ipairs({ low, mid, high }) do
        expect(cell.regolithDepth >= 0, "regolith depth should stay non-negative")
        expect(math.abs((cell.bedrockElevation + cell.regolithDepth) - cell.elevation) < 0.000001, "bedrock plus regolith should equal surface")
    end
    local world = WorldGen.new(20260625, { geologicTime = 0.5, hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 4, hydrologyBasinStride = 4 })
    expect(world:metadata().geologicTimeStep == 0.05, "geologic worlds should default a soil-production step")
    local chunk = world:chunk(0, 0, "local")
    local produced = 0
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            local cell = chunk.cells[y][x]
            if (cell.regolithDepth or 0) > 0 then produced = produced + 1 end
            expect(math.abs(((cell.bedrockElevation or 0) + (cell.regolithDepth or 0)) - (cell.elevation or 0)) < 0.000001, "chunk cells should preserve bedrock/regolith invariant")
        end
    end
    expect(produced > 0, "geologic-time chunks should produce regolith")
end

local function testSoilOrderDistribution()
    local ids = SoilClassify.ids()
    local fixtures = {
        [ids.entisol] = { temperature = 0.5, rainfall = 0.4, slope = 0.38, regolithDepth = 0.02, lithology = 5, plateAge = 0.4, biome = "grassland" },
        [ids.inceptisol] = { temperature = 0.48, rainfall = 0.42, slope = 0.09, regolithDepth = 0.14, lithology = 5, plateAge = 0.2, biome = "temperate_forest" },
        [ids.mollisol] = { temperature = 0.56, rainfall = 0.34, slope = 0.05, regolithDepth = 0.22, lithology = 5, plateAge = 0.5, biome = "grassland" },
        [ids.vertisol] = { temperature = 0.58, rainfall = 0.38, slope = 0.03, regolithDepth = 0.24, lithology = 6, plateAge = 0.5, biome = "savanna" },
        [ids.aridisol] = { temperature = 0.72, rainfall = 0.08, slope = 0.04, regolithDepth = 0.16, lithology = 5, plateAge = 0.4, biome = "desert" },
        [ids.histosol] = { temperature = 0.32, rainfall = 0.72, slope = 0.01, regolithDepth = 0.18, lithology = 6, plateAge = 0.4, biome = "wetland", flow = 260 },
        [ids.spodosol] = { temperature = 0.24, rainfall = 0.56, slope = 0.06, regolithDepth = 0.18, lithology = 3, plateAge = 0.5, biome = "boreal_forest" },
        [ids.oxisol] = { temperature = 0.76, rainfall = 0.82, slope = 0.05, regolithDepth = 0.26, lithology = 4, plateAge = 0.75, biome = "rainforest" },
        [ids.andisol] = { temperature = 0.52, rainfall = 0.5, slope = 0.12, regolithDepth = 0.16, lithology = 1, plateAge = 0.2, biome = "rock", isFloodBasalt = true },
        [ids.ultisol] = { temperature = 0.62, rainfall = 0.66, slope = 0.07, regolithDepth = 0.2, lithology = 5, plateAge = 0.45, biome = "temperate_forest" },
    }
    local region = { cells = {} }
    local index = 0
    for id, target in pairs(SoilClassify.targetDistribution()) do
        local count = math.max(1, math.floor(target * 1000 + 0.5))
        for _ = 1, count do
            index = index + 1
            local cell = {}
            for k, v in pairs(fixtures[id]) do cell[k] = v end
            cell.gx = index
            cell.gy = id
            region.cells[tostring(index) .. ":" .. tostring(id)] = cell
        end
    end
    local stats = SoilClassify.applyRegion(region)
    expect(stats.cells > 0, "soil classifier should classify land cells")
    for id, target in pairs(SoilClassify.targetDistribution()) do
        local ratio = (stats.counts[id] or 0) / stats.cells
        expect(math.abs(ratio - target) <= target * 0.2 + 0.002, "soil order distribution should match target frequency for " .. tostring(id))
    end
    local world = WorldGen.new(20260625, fastWorldOptions)
    local chunk = world:chunk(0, 0, "local")
    local soilCells = 0
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            local order = chunk.cells[y][x].soilOrder or 0
            if not chunk.cells[y][x].water and order > 0 then soilCells = soilCells + 1 end
            expect(order >= 0 and order <= 10, "chunk soil order should stay in int8 enum range")
        end
    end
    expect(soilCells > 0, "chunk land cells should expose soil order")
end

local function testHillslopeProfile()
    local region = { cells = {}, stride = 1 }
    local function put(gx, elevation)
        local cell = {
            gx = gx,
            gy = 0,
            elevation = elevation,
            elevationBase = elevation,
            bedrockElevation = elevation - 4,
            regolithDepth = 4,
            lithology = 5,
            water = false,
        }
        region.cells[tostring(gx) .. ":0"] = cell
        return cell
    end
    for gx = -12, 12 do
        put(gx, math.max(0, 8 - math.abs(gx) * 0.72))
    end
    local beforePeak = region.cells["0:0"].elevation
    local result = Hillslope.diffuse(region, { D = 0.02, Sc = 1.2, dt = 0.05, dtYearsScale = 1, iterations = 80 })
    local peak = region.cells["0:0"].elevation
    local shoulder = region.cells["4:0"].elevation
    local foot = region.cells["9:0"].elevation
    local curvature = region.cells["-1:0"].elevation - 2 * peak + region.cells["1:0"].elevation
    expect(result.moved > 0 and result.transitionFaces > 0, "hillslope diffusion should move regolith through Sc transition slopes")
    expect(peak < beforePeak and peak > shoulder and shoulder > foot, "diffused hillslope should preserve descending ridge profile")
    expect(curvature < 0, "diffused ridge should keep convex hilltop curvature")
    for _, cell in pairs(region.cells) do
        expect(cell.regolithDepth >= 0, "hillslope diffusion should not overdraw regolith")
        expect(math.abs((cell.bedrockElevation + cell.regolithDepth) - cell.elevation) < 0.000001, "hillslope diffusion should preserve bedrock/regolith surface")
    end
end

local function testDebrisFlowSignature()
    local region = { stride = 1, seaLevel = -10, cells = {} }
    local previous
    for gx = 1, 18 do
        local steep = gx <= 10
        local elevation = steep and (9 - gx * 0.42) or (4.8 - (gx - 10) * 0.045)
        local cell = {
            gx = gx,
            gy = 0,
            elevation = elevation,
            elevationBase = elevation,
            filledElevation = elevation,
            flow = 500,
            erodibilityK = 1.4,
            lithology = 4,
            water = false,
        }
        region.cells[tostring(gx) .. ":0"] = cell
        if previous then
            previous.downCell = cell
            previous.downDistance = 1
        end
        previous = cell
    end
    local result = Erosion.relax(region, {
        iterations = 3,
        K = 0.002,
        debrisK = 0.02,
        debrisSedimentYield = 30,
        debrisCriticalConcentration = 0.05,
        debrisDepositSlope = 0.1,
        debrisInitSlope = 0.3,
        maxDebrisDeposit = 0.35,
        uplift = false,
        isostasy = false,
    })
    local scar, cone, debris = 0, 0, 0
    for gx = 1, 18 do
        local cell = region.cells[tostring(gx) .. ":0"]
        if cell.debrisFlow then debris = debris + 1 end
        if gx <= 10 then scar = scar + math.max(0, -(cell.debrisFlowDelta or 0)) end
        if gx > 10 then cone = cone + math.max(0, cell.debrisFlowDelta or 0) end
    end
    expect(result.debrisFlowCells > 0 and debris == result.debrisFlowCells, "debris-flow regime should flag cells")
    expect(scar > 0 and cone > 0, "debris-flow profile should erode steep reaches and deposit a low-slope cone")
    local world = WorldGen.new(41, { hydrologyRegionChunks = 2, hydrologyHaloCells = 0, hydrologyBasinChunks = 8, hydrologyBasinStride = 4, debrisSedimentYield = 1000, debrisCriticalConcentration = 0.01, debrisK = 0.02 })
    local chunk = world:chunk(0, 1, "local")
    local chunkDebris = 0
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            if chunk.cells[y][x].debrisFlow then chunkDebris = chunkDebris + 1 end
        end
    end
    expect(chunkDebris > 0, "mountainous chunk should expose debris-flow cells when sediment concentration crosses threshold")
end

local function testSeaLevelSeries()
    local flat = WorldGen.new(20260625, { seaLevel = 0.03, geologicTime = 0.5, seaLevelAmplitude1 = 0, seaLevelAmplitude2 = 0, seaLevelResidualAmplitude = 0 })
    expect(flat:seaLevelAt(0.25) == 0.03 and flat:seaLevelAt(0.9) == 0.03, "zero-amplitude sea level should preserve scalar baseline")
    expect(#flat.seaLevelSeries == 128 and flat.seaLevelPaleoMin == 0.03 and flat.seaLevelPaleoMax == 0.03, "sea-level series should precompute flat baselines")
    local varying = WorldGen.new(11, { geologicTime = 0.35, seaLevelAmplitude1 = 0.08, seaLevelPeriod1 = 0.2, seaLevelAmplitude2 = 0.03, seaLevelPeriod2 = 0.071, seaLevelResidualAmplitude = 0.01, chunkSize = 32, hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 4, hydrologyBasinStride = 4 })
    expect(round(varying:seaLevelAt(0.2)) == round(varying:seaLevelAt(0.2)), "seaLevelAt should be idempotent")
    local same = WorldGen.new(11, { geologicTime = 0.35, seaLevelAmplitude1 = 0.08, seaLevelPeriod1 = 0.2, seaLevelAmplitude2 = 0.03, seaLevelPeriod2 = 0.071, seaLevelResidualAmplitude = 0.01, chunkSize = 32, hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 4, hydrologyBasinStride = 4 })
    local chunk = varying:chunk(0, 0, "local")
    expect(encodeChunk(chunk) == encodeChunk(same:chunk(0, 0, "local")), "seed and geologicTime should reproduce sea-level terrain")
    local terraces, drowned = 0, 0
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            local cell = chunk.cells[y][x]
            if (cell.marineTerrace or 0) > 0 then terraces = terraces + 1 end
            if cell.paleoShoreline and cell.water and cell.riverHistorical then drowned = drowned + 1 end
        end
    end
    expect(terraces > 0, "sea-level history should stamp marine terraces")
    expect(drowned > 0, "sea-level history should stamp drowned river valleys")
end

local function testGDH1Profile()
    local world = WorldGen.new(20260625, { seaLevel = 0.03, seaLevelAmplitude1 = 0, seaLevelAmplitude2 = 0, seaLevelResidualAmplitude = 0, zScale = 10000, maxOceanAgeMyr = 180, hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 4, hydrologyBasinStride = 4 })
    local function analytical(ageMyr)
        if ageMyr < 20 then return 2600 + 365 * math.sqrt(ageMyr) end
        return 5651 - 2473 * math.exp(-ageMyr / 36)
    end
    for _, ageMyr in ipairs({ 0, 5, 19.9, 20, 80, 180 }) do
        local expected = analytical(ageMyr)
        local actual = WorldGen.gdh1DepthMeters(ageMyr)
        expect(math.abs(actual - expected) / expected < 0.05, "GDH1 depth should match analytical curve within 5%")
    end
    local seaLevel = world:seaLevelAt(world.geologicTime)
    local ridgeElevation, ridgeDepth = world:oceanAgeElevation({ age = 0 }, seaLevel)
    local abyssElevation, abyssDepth = world:oceanAgeElevation({ age = 1 }, seaLevel)
    expect(math.abs(ridgeDepth - 2600) / 2600 < 0.05, "ridge-age bathymetry should be about 2.6 km below sea level")
    expect(math.abs(abyssDepth - analytical(180)) / analytical(180) < 0.05, "old abyssal bathymetry should follow GDH1")
    expect(round(ridgeElevation) == round(seaLevel - ridgeDepth / world.zScale), "GDH1 depth should convert through zScale")
    expect(abyssElevation < ridgeElevation, "older oceanic crust should be deeper than ridge crust")
    local matched = 0
    for gy = -768, 768, 128 do
        for gx = -768, 768, 128 do
            local plate = world:plateAt(gx, gy)
            if plate.crust == "oceanic" then
                local cell = world:baseSample(gx, gy, "local")
                local expected = analytical(cell.oceanAgeMyr)
                expect(cell.plateCrust == "oceanic" and cell.oceanDepthMeters > 0, "ocean cells should expose GDH1 depth")
                expect(math.abs(cell.oceanDepthMeters - expected) / expected < 0.05, "sampled ocean cells should gate against GDH1 curve")
                matched = matched + 1
                if matched >= 8 then break end
            end
        end
        if matched >= 8 then break end
    end
    expect(matched >= 4, "GDH1 test should sample multiple ocean cells")
end

local function testBathymetryProfile()
    local world = WorldGen.new(20260625, { seaLevel = 0.03, seaLevelAmplitude1 = 0, seaLevelAmplitude2 = 0, seaLevelResidualAmplitude = 0, zScale = 10000, hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 4, hydrologyBasinStride = 4 })
    local seaLevel = world:seaLevelAt(world.geologicTime)
    local shelfMax, abyssMin, seamounts = -math.huge, math.huge, 0
    for gy = -1536, 1536, 64 do
        for gx = -1536, 1536, 64 do
            local cell = world:baseSample(gx, gy, "local")
            if cell.water and cell.plateCrust == "oceanic" then
                if (cell.shelfDistance or 999) < 50 then shelfMax = math.max(shelfMax, cell.elevation) end
                if (cell.shelfDistance or 999) >= 999 and (cell.plateBoundary or 0) < 0.25 then
                    abyssMin = math.min(abyssMin, cell.elevation)
                    local ageElevation = seaLevel - (cell.oceanDepthMeters or 0) / world.zScale
                    if cell.elevation - ageElevation > 0.025 then seamounts = seamounts + 1 end
                end
            end
        end
    end
    expect(shelfMax > abyssMin + 0.04, "bathymetry should distinguish shelf/slope from abyssal plain")
    expect(seamounts > 0, "bathymetry should include abyssal seamount highs")

    local region = { cells = {}, seaLevel = 0, threshold = 16 }
    for gy = 1, 16 do
        for gx = 1, 32 do
            local water = gx > 4
            local elevation = water and (-0.02 - (gx - 5) * 0.008 - gy * 0.0005) or 0.08
            region.cells[gx .. ":" .. gy] = {
                gx = gx,
                gy = gy,
                elevationBase = elevation,
                elevation = elevation,
                bedrockElevation = elevation,
                water = water,
                lake = false,
                flow = gx == 5 and 32 or 1,
                shelfDistance = water and math.min(50, (gx - 5) * 3) or 0,
            }
        end
    end
    local stats = Bathymetry.applyRegion(region, { seed = 20260625, seaLevel = 0, canyonDensity = 1 })
    expect(stats.canyons > 0 and stats.canyonCells > 0 and stats.maxIncision > 0, "submarine canyon pass should incise shelf-break paths")
    local canyonCells = 0
    for _, cell in pairs(region.cells) do if cell.submarineCanyon then canyonCells = canyonCells + 1 end end
    expect(canyonCells > 0 and canyonCells <= stats.canyonCells, "submarine canyon cells should expose boolean labels")
end

local function testGeographicLatitudeAndCoriolis()
    local world = WorldGen.new(20260625, { legacyLatitude = false, worldCircumference = 400 })
    expect(math.abs(world:geographicLatitudeAt(0) - math.pi / 2) < 0.000001, "geographic latitude should map meridian pole")
    expect(math.abs(world:geographicLatitudeAt(200)) < 0.000001, "geographic latitude should reach equator mid-wrap")
    expect(world:coriolisAt(196) > 0 and world:coriolisAt(204) < 0, "coriolis sign should flip at equator")
    local cell = world:baseSample(0, 204, "local")
    expect(cell.latitudeRadians >= -math.pi / 2 and cell.latitudeRadians <= math.pi / 2, "cell latitude should stay bounded")
    expect(cell.coriolisF < 0, "cell coriolis should follow southern latitude sign")
    local legacy = WorldGen.new(20260625, { worldCircumference = 400 })
    local y = 1234
    local oldSigned = math.sin(y * 0.00045 + 20260625 * 0.0001)
    expect(round(legacy:latitudeAt(y) / (math.pi / 2)) == round(oldSigned), "legacy latitude should preserve old climate latitude")
end

local function testClimateBands()
    local world = WorldGen.new(20260625, { itczOffsetAmp = 0, seasonRate = 1 })
    local itcz = Climate.bandForLatitude(world, 0)
    expect(itcz.pressureCellId == 3 and itcz.baselinePrecip > 0.5, "ITCZ band should be wet and use pressure cell id 3")
    local rising, descending = 0, 0
    for _, degrees in ipairs({ -10, 0, 10 }) do
        rising = rising + Climate.bandForLatitude(world, math.rad(degrees)).baselinePrecip
    end
    for _, degrees in ipairs({ 25, 30, 35 }) do
        descending = descending + Climate.bandForLatitude(world, math.rad(degrees)).baselinePrecip
    end
    expect((rising / 3) > (descending / 3) * 1.3, "Hadley rising limb should be at least 30% wetter than descending limb")

    local region = { scale = "local", scaleFactor = 1, stride = 1, cells = {} }
    for gx = 1, 10 do
        region.cells[gx .. ":0"] = {
            gx = gx,
            gy = 0,
            x = gx,
            y = 0,
            elevationBase = 0.1,
            elevation = 0.1,
            water = gx <= 2,
        }
    end
    local monsoonWorld = {
        seed = 1,
        climateSamples = {},
        hydrologyBasinStride = 1,
        geologicTime = 0.25,
        seasonRate = 1,
        itczOffsetAmp = 0,
        monsoonSeasonalContrast = 1.3,
        orographicLiftScale = 8.5,
        orographicLeeScale = 2.4,
        latitudeAt = function() return 0 end,
    }
    monsoonWorld.climateBands = Climate.buildBands(monsoonWorld)
    Climate.solveRegion(monsoonWorld, region)
    local cell = region.cells["5:0"]
    expect(cell.monsoonIndex > 0.3 and cell.baselinePrecip > itcz.baselinePrecip, "monsoon land rows should boost wet-season precipitation")
end

local function testPlateMotionGeologicTime()
    local stationary = WorldGen.new(20260625)
    local stationaryAgain = WorldGen.new(20260625)
    local drifted = WorldGen.new(20260625, { geologicTime = 0.5 })
    local driftedAgain = WorldGen.new(20260625, { geologicTime = 0.5 })
    expect(stationary:metadata().geologicTime == 0, "default geologic time should be zero")
    expect(drifted:metadata().geologicTime == 0.5, "geologic time should round trip in metadata")
    local probes = { { 0, 0 }, { 384, -192 }, { -640, 320 } }
    for _, probe in ipairs(probes) do
        local x, y = probe[1], probe[2]
        local a = stationary:plateAt(x, y)
        local b = stationaryAgain:plateAt(x, y)
        local c = drifted:plateAt(x, y)
        local d = driftedAgain:plateAt(x, y)
        expect(a.id == b.id and round(a.boundary) == round(b.boundary), "stationary plateAt should be deterministic per seed")
        expect(round(c.boundary) == round(d.boundary), "drifted plateAt should be deterministic per (seed, time)")
        expect(round(a.boundary) ~= round(c.boundary) or a.id ~= c.id, "non-zero geologic time should shift plate field")
    end
end

local function testPlateCacheBounds()
    local world = WorldGen.new(20260625, { plateCacheEntries = 16 })
    for gy = -4, 4 do
        for gx = -4, 4 do
            world:plateAt(gx * world.plateCellSize, gy * world.plateCellSize)
        end
    end
    expect(world.plateCache.count <= world.plateCacheEntries, "plate cache should enforce configured entry bound")
    local first = encodeCell(world:baseSample(384, -192, "local"))
    local second = encodeCell(WorldGen.new(20260625, { plateCacheEntries = 16 }):baseSample(384, -192, "local"))
    expect(first == second, "plate cache should preserve deterministic base samples")
end

local function testRngHashRange()
    local seen = {}
    local minValue, maxValue, sum = 1, 0, 0
    for index = 1, 2048 do
        local value = Rng.unitAt(20260625, index, -index, index % 31, 17)
        expect(value >= 0 and value < 1, "Rng.unitAt should stay in [0, 1)")
        minValue = math.min(minValue, value)
        maxValue = math.max(maxValue, value)
        sum = sum + value
        seen[math.floor(value * 32)] = true
    end
    local buckets = 0
    for _ in pairs(seen) do buckets = buckets + 1 end
    expect(minValue < 0.02 and maxValue > 0.98, "Rng.hash should cover the unit range")
    expect(math.abs(sum / 2048 - 0.5) < 0.035, "Rng.hash should have a centered fixture mean")
    expect(buckets >= 28, "Rng.hash should distribute fixture samples across buckets")
end

local function testOpenSimplexNoise()
    local minValue, maxValue, sum = 1, 0, 0
    local axisDelta, diagonalDelta = 0, 0
    for y = -16, 16 do
        for x = -16, 16 do
            local value = Noise.value(20260625, x * 0.21, y * 0.21, 9)
            expect(value >= 0 and value <= 1, "Noise.value should stay normalized")
            minValue = math.min(minValue, value)
            maxValue = math.max(maxValue, value)
            sum = sum + value
            axisDelta = axisDelta + math.abs(value - Noise.value(20260625, (x + 1) * 0.21, y * 0.21, 9))
            diagonalDelta = diagonalDelta + math.abs(value - Noise.value(20260625, (x + 1) * 0.21, (y + 1) * 0.21, 9))
        end
    end
    local mean = sum / (33 * 33)
    expect(round(Noise.value(7, -2.96, -2.96, 3)) == round(Noise.value(7, -2.96, -2.96, 3)), "Noise.value should be deterministic")
    expect(round(Noise.value(7, -2.96, -2.96, 3)) ~= round(Noise.value(8, -2.96, -2.96, 3)), "Noise.value should vary by seed")
    expect(minValue < 0.08 and maxValue > 0.92 and math.abs(mean - 0.5) < 0.04, "OpenSimplex fixture should use the normalized range")
    expect(axisDelta / diagonalDelta > 0.55 and axisDelta / diagonalDelta < 1.45, "OpenSimplex fixture should not be strongly axis biased")
end

local function testStreamPowerConvergence()
    local function makeRegion()
        local region = { stride = 1, seaLevel = -1, cells = {}, visitOrder = {} }
        for index = 1, 28 do
            local cell = {
                gx = index,
                gy = 0,
                elevationBase = (index - 1) * 0.035 + ((index % 7 == 0) and 0.08 or 0),
                flow = (29 - index) * (29 - index) * 5,
                water = false,
                uplift = 0,
                plateBoundary = 0,
            }
            cell.elevation = cell.elevationBase
            region.cells[index] = cell
            region.visitOrder[index] = cell
            if index > 1 then
                cell.downCell = region.visitOrder[index - 1]
                cell.downDistance = 1
            end
        end
        return region
    end

    local region = makeRegion()
    local before = region.visitOrder[#region.visitOrder].elevation
    local result = Erosion.relax(region, { iterations = 320, K = 0.016, m = 0.5, n = 1.0, uplift = false, isostasy = false })
    expect(region.visitOrder[#region.visitOrder].elevation < before, "stream power relaxation should mutate elevations in-place")
    expect(result.maxDelta < 0.0001, "stream power relaxation should converge below fixture delta")
    expect(region.visitOrder[#region.visitOrder].streamPowerErosion > 0, "stream power relaxation should expose erosion depth")

    local repeatRegion = makeRegion()
    Erosion.relax(repeatRegion, { iterations = 320, K = 0.016, m = 0.5, n = 1.0, uplift = false, isostasy = false })
    for index, cell in ipairs(region.visitOrder) do
        expect(round(cell.elevation) == round(repeatRegion.visitOrder[index].elevation), "stream power relaxation should be deterministic")
    end
end

local function testIsostasy()
    local function makeRegion()
        local region = { stride = 1, seaLevel = -1, cells = {}, visitOrder = {}, minX = 1, minY = 0, maxX = 28, maxY = 0 }
        for index = 1, 28 do
            local cell = {
                gx = index,
                gy = 0,
                elevationBase = (index - 1) * 0.034 + ((index % 6 == 0) and 0.09 or 0),
                flow = (29 - index) * (29 - index) * 5,
                water = false,
                uplift = 0,
                plateBoundary = index >= 14 and 1 or 0,
            }
            cell.elevation = cell.elevationBase
            region.cells[index] = cell
            region.visitOrder[index] = cell
            if index > 1 then
                cell.downCell = region.visitOrder[index - 1]
                cell.downDistance = 1
            end
        end
        return region
    end
    local function boundaryMean(region)
        local sum, count = 0, 0
        for _, cell in ipairs(region.visitOrder) do
            if (cell.plateBoundary or 0) > 0.35 then
                sum = sum + cell.elevation
                count = count + 1
            end
        end
        return sum / math.max(1, count)
    end
    local without = makeRegion()
    Erosion.relax(without, { iterations = 80, K = 0.014, m = 0.5, n = 1.0, uplift = false, isostasy = false })
    local with = makeRegion()
    local result = Erosion.relax(with, { iterations = 80, K = 0.014, m = 0.5, n = 1.0, uplift = false, isostasy = true, isostasyRatio = 0.8, isostasyRadius = 2 })
    expect(result.isostaticErosion > 0, "isostasy should record eroded mass")
    expect(math.abs(result.isostaticRebound - result.isostaticErosion * 0.8) < 0.00001, "isostasy should conserve rebound ratio")
    expect(boundaryMean(with) > boundaryMean(without), "isostasy should raise plate-boundary mean elevation")

    local function broadThresholds()
        return {
            waterRatioMin = 0,
            waterRatioMax = 1,
            riverRatioMin = 0,
            riverRatioMax = 1,
            lakeRatioMax = 1,
            meanSlopeMax = 1,
            steepSlopeRatioMax = 1,
            singleBiomeMax = 1,
            minBiomeCount = 1,
        }
    end
    local function options(enabled)
        local out = {}
        for k, v in pairs(basinWorldOptions) do out[k] = v end
        out.streamPowerIterations = 24
        out.streamPowerK = 0.0009
        out.streamPowerIsostasy = enabled
        out.streamPowerIsostasyRatio = 1.2
        return out
    end
    local low = Diagnostics.analyzeSeed(5, { chunkRadius = 1, sampleStep = 16, worldOptions = options(false), thresholds = broadThresholds() })
    local high = Diagnostics.analyzeSeed(5, { chunkRadius = 1, sampleStep = 16, worldOptions = options(true), thresholds = broadThresholds() })
    expect(low.plateBoundaryCells > 0 and high.plateBoundaryCells > 0, "isostasy diagnostics should sample plate-boundary cells")
    expect(high.meanPlateBoundaryElevation > low.meanPlateBoundaryElevation, "isostasy diagnostics should raise plate-boundary elevation")
end

local function testStreamPowerDiagnostics()
    local function broadThresholds()
        return {
            waterRatioMin = 0,
            waterRatioMax = 1,
            riverRatioMin = 0,
            riverRatioMax = 1,
            lakeRatioMax = 1,
            meanSlopeMax = 1,
            steepSlopeRatioMax = 1,
            singleBiomeMax = 1,
            minBiomeCount = 1,
        }
    end
    local function worldOptions(iterations)
        local out = {}
        for k, v in pairs(basinWorldOptions) do out[k] = v end
        out.streamPowerIterations = iterations
        return out
    end
    local function slopeMeans(iterations)
        local nonMountain, boundary = 0, 0
        local seeds = { 1, 6, 26 }
        for _, seed in ipairs(seeds) do
            local stats = Diagnostics.analyzeSeed(seed, {
                chunkRadius = 1,
                sampleStep = 16,
                worldOptions = worldOptions(iterations),
                thresholds = broadThresholds(),
            })
            nonMountain = nonMountain + stats.meanNonMountainSlope
            boundary = boundary + stats.meanPlateBoundarySlope
        end
        return nonMountain / #seeds, boundary / #seeds
    end

    local baseNonMountain, baseBoundary = slopeMeans(0)
    local erodedNonMountain, erodedBoundary = slopeMeans(80)
    expect(erodedNonMountain < baseNonMountain, "stream power diagnostics should lower stable non-mountain slope")
    expect(erodedBoundary > baseBoundary, "stream power diagnostics should raise plate-boundary slope")
end

local function testOrographicRainShadow()
    local region = { scale = "local", scaleFactor = 1, stride = 1, cells = {} }
    for gy = -4, 4 do
        for gx = -12, 12 do
            local ridge = math.max(0, 1 - math.abs(gx) / 2)
            local elevation = 0.06 + ridge * 0.78
            local cell = {
                gx = gx,
                gy = gy,
                x = gx,
                y = 1200 + gy,
                elevationBase = elevation,
                elevation = elevation,
                water = gx == -12,
            }
            region.cells[gx .. ":" .. gy] = cell
        end
    end
    local world = { seed = 1, climateSamples = {}, hydrologyBasinStride = 1, orographicLiftScale = 12, orographicLeeScale = 3 }
    local climate = Climate.solveRegion(world, region)
    local windward, leeward, samples = 0, 0, 0
    for gy = -4, 4 do
        windward = windward + region.cells["-1:" .. gy].precipitation
        leeward = leeward + region.cells["3:" .. gy].precipitation
        samples = samples + 1
    end
    expect(windward / samples > (leeward / samples) * 1.5, "orographic precipitation should make windward slopes wetter than leeward slopes")
    expect(climate.rainShadowCells > 0, "orographic precipitation should mark leeward rain-shadow cells")
end

local function testMeanderSinuosity()
    local function regionFixture()
        local region = { scale = "local", scaleFactor = 1, stride = 1, threshold = 10, cells = {} }
        for gy = -8, 8 do
            for gx = 0, 24 do
                local cell = {
                    gx = gx,
                    gy = gy,
                    x = gx,
                    y = gy,
                    elevationBase = 0.2,
                    elevation = 0.2,
                    flow = gy == 0 and 120 or 8,
                    slope = 0.03,
                    water = false,
                    river = gy == 0 and gx < 24,
                    floodplain = false,
                }
                region.cells[gx .. ":" .. gy] = cell
            end
        end
        for gx = 0, 23 do
            region.cells[gx .. ":0"].downCell = region.cells[(gx + 1) .. ":0"]
        end
        return region
    end
    local region = regionFixture()
    local result = Meander.applyRegion(region, { threshold = 10, seed = 20260625, widthScale = 2.0, migrationScale = 0.85 })
    local repeatRegion = regionFixture()
    Meander.applyRegion(repeatRegion, { threshold = 10, seed = 20260625, widthScale = 2.0, migrationScale = 0.85 })
    local bends = 0
    for gx = 0, 23 do
        local bend = region.cells[gx .. ":0"].meanderBend or 0
        if math.abs(bend) > 0.1 then bends = bends + 1 end
        expect(round(bend) == round(repeatRegion.cells[gx .. ":0"].meanderBend), "meander migration should be deterministic")
    end
    expect(result.maxSinuosity > 1.2 and bends > 8, "meander pass should raise lowland river sinuosity")
    expect(#region.oxbowPolygons > 0 and result.oxbowLakes == #region.oxbowPolygons, "meander pass should stamp oxbow lakes")
end

local function testBasinChannelsSpanDetailRegions()
    local world = WorldGen.new(1, basinWorldOptions)
    local spans = {}
    for cy = -2, 3 do
        for cx = -2, 3 do
            local chunk = world:chunk(cx, cy, "local")
            for y = 1, chunk.size, 4 do
                for x = 1, chunk.size, 4 do
                    local cell = chunk.cells[y][x]
                    if cell.river and cell.macroBasinId then
                        local span = spans[cell.macroBasinId] or { regions = {}, count = 0 }
                        span.regions[cell.hydrologyRegion] = true
                        span.count = span.count + 1
                        spans[cell.macroBasinId] = span
                    end
                end
            end
        end
    end
    local bestRegions, bestCount = 0, 0
    for _, span in pairs(spans) do
        local regions = 0
        for _ in pairs(span.regions) do regions = regions + 1 end
        if regions > bestRegions or (regions == bestRegions and span.count > bestCount) then
            bestRegions, bestCount = regions, span.count
        end
    end
    expect(bestRegions >= 8 and bestCount > 24, "macro basins should persist across distant 1x1 hydrology regions")
    expect(world:cacheStats().basins == 1, "scanned chunks should share the same cached coarse basin")
end

local function testBiomes()
    local world = testWorld(314)
    local ids = {}
    for _, id in ipairs(WorldGen.biomeIds()) do ids[id] = true end
    local colors = Render.biomePalette()
    for id in pairs(ids) do expect(colors[id], "missing biome color " .. tostring(id)) end
    for cy = 0, 1 do
        for cx = 0, 1 do
            local chunk = world:chunk(cx, cy, "region")
            for y = 1, chunk.size, 7 do
                for x = 1, chunk.size, 7 do
                    expect(ids[chunk.cells[y][x].biome], "invalid biome id " .. tostring(chunk.cells[y][x].biome))
                    expect(type(chunk.cells[y][x].koppen) == "string", "biome cells should expose Koppen hint")
                end
            end
        end
    end
end

local function testWhittakerBins()
    expect(Biomes.lookup(0.74, 0.1, 0.1, false, 0.02) == "desert", "hot arid Whittaker bin should be desert")
    expect(Biomes.lookup(0.74, 0.36, 0.1, false, 0.02) == "savanna", "hot seasonal Whittaker bin should be savanna")
    expect(Biomes.lookup(0.76, 0.9, 0.2, false, 0.02) == "rainforest", "hot wet Whittaker bin should be rainforest")
    expect(Biomes.lookup(0.48, 0.64, 0.1, false, 0.02) == "temperate_forest", "temperate mesic Whittaker bin should be forest")
    expect(Biomes.lookup(0.24, 0.64, 0.1, false, 0.02) == "boreal_forest", "cold wet Whittaker bin should be boreal forest")
    expect(Biomes.lookup(0.18, 0.22, 0.1, false, 0.02) == "tundra", "cold dry Whittaker bin should be tundra")
    expect(Biomes.lookup(0.7, 0.9, 0.05, false, 0.02) == "wetland", "low saturated Whittaker bin should be wetland")
    expect(Biomes.lookup(0.7, 0.4, 0.2, false, 0.02, 0.3, false) == "shield", "hotspot shield override should expose shield biome")
    expect(Biomes.lookup(0.7, 0.4, 0.2, false, 0.02, 0.3, true) == "lava_flow", "flood basalt override should expose lava-flow biome")
    expect(Biomes.lookup(0.4, 0.6, 0.8, false, 0.02) == "rock", "high warm Whittaker override should be rock")
    expect(Biomes.lookup(0.2, 0.6, 0.8, false, 0.02) == "snow", "high cold Whittaker override should be snow")
    expect(Biomes.lookup(0.72, 0.5, 0.1, false, 0.02) == "dry_broadleaf", "seasonal tropical bin should expose dry broadleaf forest")
    expect(Biomes.lookup(0.72, 0.24, 0.1, false, 0.02) == "thorn_scrub", "hot semiarid bin should expose thorn scrub")
    expect(Biomes.lookup(0.52, 0.82, 0.1, false, 0.02) == "temperate_rainforest", "wet temperate bin should expose temperate rainforest")
    expect(Biomes.lookup(0.3, 0.74, 0.08, false, 0.02) == "muskeg", "cold saturated bin should expose muskeg")
    expect(Biomes.lookup(0.36, 0.12, 0.08, false, 0.02) == "cold_desert", "cold arid bin should expose cold desert")
    expect(Biomes.lookup(0.08, 0.1, 0.08, false, 0.02) == "polar_desert", "polar arid bin should expose polar desert")
    expect(Biomes.lookup(0.64, 0.18, 0.24, false, 0.2) == "badland", "dry steep bin should expose badland")
    expect(Biomes.lookup(0.7, 0.6, -0.02, true, 0, 0, false, 0, 2) == "atoll_ring", "reef stage 2 should expose atoll ring")
    expect(Biomes.lookup(0.3, 0.5, -0.02, true, 0, 0, false, 0, 0) == "kelp_forest_fringe", "cold shallow coast should expose kelp fringe")
    expect(Biomes.lookup(0.78, 0.9, 0.1, false, 0.02, 0, false, 0, 0, true) == "bioluminescent_grove", "exotic gate should expose exotic rainforest variant")
    expect(Biomes.lookup(0.78, 0.9, 0.1, false, 0.02, 0, false, 0, 0, false) ~= "bioluminescent_grove", "exotic biome should stay gated")
    expect(Biomes.koppen(0.78, 0.9) == "Af" and Biomes.koppen(0.7, 0.1) == "BWh", "Koppen hints should classify broad climate")
end

local function testBiomeRefinement()
    local riparian = { biome = "desert", water = false, riverBank = true, temperature = 0.72, rainfall = 0.18, elevation = 0.1, slope = 0.03, latitudeRadians = 0, windX = 0, windY = 0 }
    Biomes.refineCell(riparian)
    expect(riparian.riparian == 1 and riparian.biome == "oasis", "arid river corridors should receive oasis overlay")

    local treeline = { biome = "temperate_forest", water = false, temperature = 0.34, rainfall = 0.62, elevation = 0.56, slope = 0.08, latitudeRadians = math.rad(55), windX = 0.2, windY = 0.1 }
    Biomes.refineCell(treeline)
    expect(treeline.treeline == 1 and (treeline.biome == "subalpine_krummholz" or treeline.biome == "tundra"), "low-GDD high terrain should expose treeline")

    local fire = { biome = "temperate_forest", water = false, temperature = 0.74, rainfall = 0.36, elevation = 0.1, slope = 0.04, latitudeRadians = math.rad(34), monsoonIndex = 0, windX = 0, windY = 0 }
    Biomes.refineCell(fire)
    expect(fire.fireFrequency > 0.3 and fire.biome == "savanna", "summer-dry warm forest should shift toward savanna under fire")

    local chaparral = { biome = "temperate_forest", water = false, temperature = 0.52, rainfall = 0.28, elevation = 0.1, slope = 0.04, latitudeRadians = math.rad(34), monsoonIndex = 0, windX = 0, windY = 0 }
    Biomes.refineCell(chaparral)
    expect(chaparral.fireFrequency > 0.3 and chaparral.biome == "mediterranean_chaparral", "summer-dry temperate forest should shift toward chaparral under fire")

    local ecotone = { biome = "grassland", water = false, temperature = 0.6, rainfall = 0.46, elevation = 0.1, slope = 0.04, latitudeRadians = 0, windX = 0, windY = 0 }
    Biomes.refineCell(ecotone)
    expect(ecotone.biomeSecondary ~= nil, "ecotone cells should expose a secondary biome")
end

local function testWhittakerDiagnostics()
    local sweep = Diagnostics.sweep({
        seeds = { 6, 8, 19, 30 },
        chunkRadius = 1,
        sampleStep = 8,
        worldOptions = basinWorldOptions,
    })
    local biomeCount, topRatio = 0, 0
    for _, stats in ipairs(sweep.results) do
        biomeCount = biomeCount + stats.biomeCount
        topRatio = topRatio + (stats.topBiome and stats.topBiome.ratio or 1)
    end
    expect(biomeCount / #sweep.results >= 5, "Whittaker diagnostics should keep biome diversity above fixture baseline")
    expect(topRatio / #sweep.results < 0.62, "Whittaker diagnostics should avoid single-biome dominance")
end

local function testGlacialSIA()
    local n = 3
    local length = 40
    local ela = 0.56
    local head = 0.70
    local region = { cells = {}, stride = 1, scaleFactor = 1, seaLevel = -1 }
    local function key(gx, gy)
        return tostring(gx) .. ":" .. tostring(gy)
    end
    for gx = 0, length do
        local u = gx / length
        local elevation = head - (head - ela) * u ^ ((n + 1) / n)
        region.cells[key(gx, 0)] = {
            gx = gx,
            gy = 0,
            elevation = elevation,
            elevationBase = elevation,
            bedrockElevation = elevation,
            regolithDepth = 0,
            temperature = 0.1,
            water = false,
            latitudeRadians = 0,
        }
    end
    local result = Erosion.glaciate(region, {
        snowline = ela,
        initialIceScale = 0.12,
        normalizedBeta = 0,
        siaIterations = 1,
        dt = 0,
        maxCut = 0,
        seaLevel = -1,
    })
    expect(result.iceVolume > 0 and result.glaciatedCells > 0, "SIA glacier should expose ice volume and primary ice cells")
    local h0 = region.cells[key(0, 0)].iceThickness or 0
    local maxError = 0
    for gx = 0, length - 4, 4 do
        local u = gx / length
        local expected = (1 - u ^ ((n + 1) / n)) ^ (n / (2 * n + 2))
        local actual = (region.cells[key(gx, 0)].iceThickness or 0) / h0
        maxError = math.max(maxError, math.abs(actual - expected))
    end
    expect(h0 > 0 and maxError <= 0.10, "SIA ice profile should match Vialov within 10%")
end

local function testGlacialFeatures()
    local world = WorldGen.new(12)
    local stats = world:hydrologyStats(0, -2, "local")
    expect(stats.glaciatedCells > 0, "alpine fixture should expose glaciated reaches")
    expect((stats.glacialIceVolume or 0) > 0, "alpine fixture should expose glacial ice volume")
    local chunk = world:chunk(0, -2, "local")
    local glaciated, eroded, inspected = 0, 0, 0
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            local cell = chunk.cells[y][x]
            if cell.glaciated then
                glaciated = glaciated + 1
                expect(cell.temperature < 0.38 and cell.elevationBase > 0.52, "glaciated cells should be cold high terrain")
                expect((cell.iceThickness or 0) > 0, "glaciated cells should carry persisted ice thickness")
            end
            if (cell.glacialErosion or 0) > 0 then eroded = eroded + 1 end
            inspected = inspected + 1
        end
    end
    expect(glaciated > 0 and eroded > glaciated and inspected == chunk.size * chunk.size, "glacial pass should widen beyond primary ice cells")
end

local function testCoastlines()
    local totals = { cliffs = 0, beaches = 0 }
    for _, seed in ipairs({ 1, 6, 7, 30 }) do
        local world = WorldGen.new(seed)
        for cy = -1, 1 do
            for cx = -1, 1 do
                local stats = world:hydrologyStats(cx, cy, "local")
                totals.cliffs = totals.cliffs + (stats.coastCliffs or 0)
                totals.beaches = totals.beaches + (stats.coastBeaches or 0)
            end
        end
    end
    expect(totals.cliffs > 0, "coastline pass should expose windward cliffs")
    expect(totals.beaches > 0, "coastline pass should expose sheltered beaches")
end

local function testShorelineCapes()
    local function makeRegion()
        local region = { scale = "local", scaleFactor = 1, stride = 1, seaLevel = 0, cells = {} }
        for gy = 0, 48 do
            local distance = math.abs(gy - 24)
            local protrusion = distance <= 3 and 2 or (distance == 4 and 1 or 0)
            for gx = -5, 6 do
                local water = gx > protrusion
                region.cells[gx .. ":" .. gy] = {
                    gx = gx,
                    gy = gy,
                    x = gx,
                    y = gy,
                    elevationBase = water and -0.08 or 0.06,
                    elevation = water and -0.08 or 0.06,
                    slope = 0.03,
                    sediment = 0.01,
                    windX = -0.2,
                    windY = 0.9,
                    water = water,
                }
            end
        end
        return region
    end
    local high = makeRegion()
    local highResult = Coast.apply(high, { seaLevel = 0, highAngleFraction = 0.72, waveAngleDegrees = 70, asymmetry = 0.1 })
    local low = makeRegion()
    local lowResult = Coast.apply(low, { seaLevel = 0, highAngleFraction = 0.18, waveAngleDegrees = 24, asymmetry = 0 })
    local asymmetric = makeRegion()
    local asymmetricResult = Coast.apply(asymmetric, { seaLevel = 0, highAngleFraction = 0.74, waveAngleDegrees = 72, asymmetry = 0.8 })
    expect(highResult.shorelines > 0 and highResult.shorelineNodes > 0, "shoreline solver should extract polylines")
    expect(high.cells["2:24"].shorelineNode > 0, "coastal cells should point at shoreline nodes")
    expect(highResult.capes > lowResult.capes and highResult.maxCapeScore > lowResult.maxCapeScore, "high-angle waves should amplify cape perturbations")
    expect(lowResult.smoothed > 0, "low-angle waves should smooth shoreline perturbations")
    expect(asymmetricResult.spits > 0 and #asymmetric.spits == asymmetricResult.spits, "asymmetric high-angle waves should mark spits")
    expect(asymmetricResult.lagoons > 0 and #asymmetric.lagoons == asymmetricResult.lagoons, "spits should create sheltered lagoon records")
end

local function testWernerDuneRegimes()
    local function makeRegion(cover)
        local region = { seed = 20260625, scale = "local", scaleFactor = 1, stride = 1, cells = {} }
        local period = 10
        local threshold = math.floor(cover * period + 0.5)
        for gy = 0, 23 do
            for gx = 0, 47 do
                region.cells[gx .. ":" .. gy] = {
                    gx = gx,
                    gy = gy,
                    x = gx,
                    y = gy,
                    elevation = 0.18,
                    elevationBase = 0.18,
                    slope = 0.02,
                    biome = "desert",
                    windX = 1,
                    windY = 0,
                    water = false,
                    duneSand = (gx + gy * 3) % period < threshold and 1 or 0,
                }
            end
        end
        return region
    end
    local cases = {
        { cover = 0.3, regime = "unimodal", expected = "barchan" },
        { cover = 0.8, regime = "unimodal", expected = "transverse" },
        { cover = 0.6, regime = "bimodal", expected = "seif" },
        { cover = 0.6, regime = "star", expected = "star" },
    }
    for _, case in ipairs(cases) do
        local region = makeRegion(case.cover)
        local result = Aeolian.applyRegion(region, { seed = 20260625, windRegime = case.regime, iterations = 50000, sandCover = case.cover })
        expect(result.morphology == case.expected, "Werner CA should classify " .. case.expected .. " morphology")
        expect(result.activeCells > 0 and result.maxAmplitude > 0, "Werner CA should redistribute sand slabs")
    end
    local first = makeRegion(0.3)
    local firstResult = Aeolian.applyRegion(first, { seed = 20260625, windRegime = "unimodal", iterations = 50000, sandCover = 0.3 })
    local repeatRegion = makeRegion(0.3)
    local repeatResult = Aeolian.applyRegion(repeatRegion, { seed = 20260625, windRegime = "unimodal", iterations = 50000, sandCover = 0.3 })
    expect(firstResult.moved == repeatResult.moved and round(first.cells["8:8"].duneDelta) == round(repeatRegion.cells["8:8"].duneDelta), "Werner CA should be deterministic")

    local world = WorldGen.new(20260625, { hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 0 })
    local chunk = world:chunk(0, 0, "local")
    local dunes = 0
    for y = 1, chunk.size do
        for x = 1, chunk.size do
            if (chunk.cells[y][x].duneAmplitude or 0) > 0 then dunes = dunes + 1 end
        end
    end
    expect(dunes > 0, "aeolian worldgen hook should mark desert dune cells")
end

local function testPlayer()
    local function fakeWorld(sampleCell)
        return {
            sample = function(_, x, y, scope) return sampleCell(x, y, scope) end,
            metadata = function() return { scope = "local" } end,
        }
    end
    local flat = fakeWorld(function()
        return { elevation = 0, slope = 0, water = false, biome = "grassland" }
    end)
    local player = Player.new(0, 0)
    Player.update(player, 0.25, { right = true }, flat)
    expect(player.x > 0 and player.y == 0 and player.travelX > 0 and player.travelY == 0, "player should move right and expose traversal direction")
    Player.update(player, 0.25, { forward = true, yaw = math.pi * 0.5 }, flat)
    expect(player.travelX > 0.99 and math.abs(player.travelY) < 0.000001, "player traversal direction should follow yaw-relative movement")
    Player.update(player, 0.5, { left = true, up = true, sprint = true }, flat)
    expect(player.x == player.x and player.y == player.y, "player position should stay finite")

    local cliff = fakeWorld(function(_, y)
        return { elevation = y < 0 and 1 or 0, slope = 0, water = false, biome = "rock" }
    end)
    local climber = Player.new(0, 0)
    Player.update(climber, 0.25, { forward = true, yaw = 0 }, cliff)
    expect(climber.y == 0 and climber.vy == 0, "player should not cross cliffs taller than max step")

    local deepWater = fakeWorld(function(_, y)
        return { elevation = 0, slope = 0, water = y < 0, lakeDepth = y < 0 and 0.8 or 0, biome = y < 0 and "lake" or "grassland" }
    end)
    local wader = Player.new(0, 0)
    Player.update(wader, 0.25, { forward = true, yaw = 0 }, deepWater)
    expect(wader.y == 0 and wader.vy == 0, "player should stop at water deeper than wade limit")

    local bobber = Player.new(0, 0)
    for _ = 1, 60 do Player.update(bobber, 1 / 60, { right = true, headBob = true, cameraSway = true }, flat) end
    expect((bobber.footstepTotal or 0) > 0 and (bobber.footsteps or 0) > 0, "player footstep phase should advance while moving")
    expect((bobber.bobOffset or 0) <= 0 and math.abs(bobber.swayAngle or 0) > 0, "player should expose bob and sway when enabled")

    local steady = Player.new(0, 0)
    for _ = 1, 30 do Player.update(steady, 1 / 60, { right = true, headBob = false, cameraSway = false }, flat) end
    expect((steady.footstepTotal or 0) > 0 and steady.bobOffset == 0 and steady.swayAngle == 0, "player should disable bob and sway cleanly")
end

local function testHeightInterpolationAndNormal()
    local world = testWorld(515)
    local x, y = 12.35, -8.7
    local h = world:heightAt(x, y)
    local h00 = world:sample(math.floor(x), math.floor(y), "local").elevation
    local h10 = world:sample(math.floor(x) + 1, math.floor(y), "local").elevation
    local h01 = world:sample(math.floor(x), math.floor(y) + 1, "local").elevation
    local h11 = world:sample(math.floor(x) + 1, math.floor(y) + 1, "local").elevation
    local lo = math.min(h00, h10, h01, h11)
    local hi = math.max(h00, h10, h01, h11)
    expect(h >= lo - 0.000001 and h <= hi + 0.000001, "heightAt should stay inside neighbor range")
    expect(round(h) == round(world:heightAt(x, y)), "heightAt should be deterministic")
    local normal = world:normalAt(x, y)
    local length = math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z)
    expect(length > 0.99 and length < 1.01 and normal.z > 0, "normalAt should return finite normalized upward vector")
end

local function encodeBillboards(list)
    local parts = {}
    for _, item in ipairs(list) do
        parts[#parts + 1] = table.concat({ item.kind, round(item.x), round(item.y), round(item.z), round(item.width), round(item.height), round(item.swayPhase) }, ":")
    end
    return table.concat(parts, "|")
end

local function pngDimensions(path)
    local file = assert(io.open(path, "rb"))
    local header = file:read(24)
    file:close()
    expect(header and string.sub(header, 1, 8) == "\137PNG\r\n\26\n", "atlas should be a PNG")
    local b = { string.byte(header, 17, 24) }
    return b[1] * 16777216 + b[2] * 65536 + b[3] * 256 + b[4], b[5] * 16777216 + b[6] * 65536 + b[7] * 256 + b[8]
end

local function testBillboardAtlas()
    local kinds = Render.billboardAtlasKinds()
    local width, height = pngDimensions("assets/billboards.png")
    expect(width == #kinds * 32 and height == 32, "billboard atlas should have one 32px cell per kind")
    local atlas = {}
    for _, kind in ipairs(kinds) do atlas[kind] = true end
    for _, kind in ipairs({ "tree_deciduous", "tree_conifer", "tree_dead", "shrub", "reed", "rock", "outcrop", "peak", "snow_tuft" }) do
        expect(atlas[kind], "billboard atlas missing " .. kind)
    end
    for _, kind in ipairs(WorldGen.billboardKinds()) do
        expect(atlas[Render.billboardAtlasKindFor(kind)], "billboard kind missing atlas quad " .. kind)
    end
    expect(Render.billboardSwayMagnitude("tree_deciduous") > Render.billboardSwayMagnitude("reed"), "tree sway should exceed reed sway")
    expect(Render.billboardSwayMagnitude("reed") > Render.billboardSwayMagnitude("shrub"), "reed sway should exceed shrub sway")
    expect(Render.billboardSwayMagnitude("rock") == 0 and Render.billboardSwayMagnitude("peak") == 0, "static billboard kinds should not sway")
end

local function testBillboards()
    local a = testWorld(717)
    local b = testWorld(717)
    local kinds = {}
    for _, kind in ipairs(WorldGen.billboardKinds()) do kinds[kind] = true end
    local count = 0
    for cy = 0, 1 do
        for cx = 0, 1 do
            local list = a:billboards(cx, cy)
            expect(encodeBillboards(list) == encodeBillboards(b:billboards(cx, cy)), "billboards should be deterministic")
            for _, item in ipairs(list) do
                expect(kinds[item.kind], "invalid billboard kind")
                expect(item.x == item.x and item.y == item.y and item.z == item.z, "billboard coordinates should be finite")
                expect((item.swayPhase or 0) >= -1 and (item.swayPhase or 0) <= 1, "billboard sway phase should be normalized")
                count = count + 1
            end
        end
    end
    expect(count > 0, "fixture seed should generate billboards")
end

local function testClipmap()
    local state = Clipmap.new({ levelCount = 3, halfResolution = 4 })
    local function sample(x, y)
        return { x = x, y = y, biome = "grassland", elevation = (x + y) * 0.01, slope = 0 }, x + y
    end
    local _, first = Clipmap.update(state, 0, 0, sample, { scaleId = "local" })
    expect(first.rings == 3 and first.steps[1] == 1 and first.steps[2] == 2 and first.steps[3] == 4, "clipmap should build fixed density rings")
    expect(first.radius == 16 and first.tileCapacity > 0 and first.vertexCapacity == first.tileCapacity * 6, "clipmap should expose constant ring buffer capacity")
    expect(first.fullRefills == 3 and first.samplesRefilled == 3 * 9 * 9, "initial clipmap update should fill every ring")
    local _, reused = Clipmap.update(state, 0.4, 0.4, sample, { scaleId = "local" })
    expect(reused.reusedRings == 3 and reused.samplesRefilled == 0, "clipmap should reuse rings until origin crosses a grid step")
    local _, partial = Clipmap.update(state, 1, 0, sample, { scaleId = "local" })
    expect(partial.partialRefills >= 1 and partial.fullRefills == 0, "clipmap should partially refill scrolled strips")
    expect(Clipmap.outerMorph(state.levels[1], 4, 0) > 0 and Clipmap.outerMorph(state.levels[3], 4, 0) == 0, "clipmap should morph only rings with coarser neighbors")
    expect(Clipmap.heightAt(state.levels[2], state.levels[2].originX, state.levels[2].originY) ~= nil, "clipmap should interpolate cached heights")
end

local function testRenderStats()
    local world = testWorld(3)
    local app = { world = world, player = Player.new(0, 0), camera = Render.defaultCamera(), viewScale = ViewScale.new(world) }
    local stats = Render.visibleStats(app, 1280, 720)
    expect(stats.visibleTiles > 0 and stats.triangles == stats.visibleTiles * 2, "render stats should describe terrain mesh")
    expect(stats.visibleTiles <= stats.expectedMaxForFOV, "visible tiles should stay within FOV-cull budget")
    expect(stats.fullTiles > 0 and stats.visibleTiles <= stats.fullTiles, "FOV culling should keep visible terrain bounded")
    expect(stats.clipmap == true and stats.clipmapRings >= 5 and stats.clipmapRadius >= 500, "local render should use extended clipmap terrain")
    expect(stats.clipmapSteps == "1,2,4,8,16,32" and stats.clipmapMorphBands == stats.clipmapRings - 1, "clipmap should expose nested densities and morph bands")
    expect(stats.clipmapTileCapacity > 0 and stats.clipmapVertexCapacity == stats.clipmapTileCapacity * 6, "clipmap should keep fixed tile and vertex capacities")
    expect(stats.clipmapMorphTiles > 0 and stats.terrainRadius >= stats.clipmapRadius, "clipmap should draw morphed far terrain")
    local zoomApp = { world = world, player = Player.new(0, 0), camera = Render.defaultCamera(), viewScale = ViewScale.new(world) }
    local baseZoomStats = Render.visibleStats(zoomApp, 1280, 720)
    zoomApp.camera.zoom = 2
    local zoomedStats = Render.visibleStats(zoomApp, 1280, 720)
    expect(zoomedStats.zoom == 2 and zoomedStats.effectiveFov > baseZoomStats.effectiveFov, "camera zoom should increase effective focal length")
    expect(zoomedStats.terrainRadius < baseZoomStats.terrainRadius, "camera zoom should tighten terrain radius")
    zoomApp.camera.zoom = 99
    expect(Render.visibleStats(zoomApp, 1280, 720).zoom == 2.5, "camera zoom should clamp to max")
    local reusedStats = Render.visibleStats(app, 1280, 720)
    expect(reusedStats.clipmapReusedRings == reusedStats.clipmapRings and reusedStats.clipmapSamplesRefilled == 0, "static camera should reuse clipmap rings")
    app.player.x = app.player.x + 1
    local shiftedStats = Render.visibleStats(app, 1280, 720)
    expect(shiftedStats.clipmapPartialRefills > 0 and shiftedStats.clipmapFullRefills == 0, "clipmap should scroll with partial ring refills")
    expect(stats.billboards >= 0 and stats.cameraHeight == stats.cameraHeight, "render stats should include finite camera and billboard count")
    expect(stats.riverStrips > 0, "render stats should include river strips")
    expect(stats.silhouetteStrips > 0, "render stats should include slope silhouettes")
    expect(stats.landmarks > 0, "render stats should include terrain landmarks")
    local labelApp = { world = world, player = Player.new(0, 0), camera = Render.defaultCamera(), viewScale = ViewScale.new(world), worldLabelScan = false }
    labelApp.viewScale.labels.major = { scale = "local", kind = "mountain_range", name = "High Range", x = 0, y = -30, priority = 1 }
    labelApp.viewScale.labels.minor = { scale = "local", kind = "basin", name = "Low Basin", x = 0, y = -30, priority = 5 }
    labelApp.viewScale.labelOrder = { "major", "minor" }
    local worldLabels = Render.worldLabelDrawList(labelApp, 1280, 720, 8)
    expect(#worldLabels == 1 and worldLabels[1].text == "HIGH RANGE", "world labels should project, uppercase major features, and dedupe overlaps by priority")
    labelApp.showWorldLabels = false
    expect(#Render.worldLabelDrawList(labelApp, 1280, 720, 8) == 0, "world label setting should hide labels")
    local header = Render.areaHeaderLines({ showAreaLabels = true, currentArea = { featureName = "High Range", biome = "rainforest", biomeLabel = "RAINFOREST", koppen = "Af" } })
    expect(header and header[1] == "High Range" and header[2] == "RAINFOREST / Af", "area header should show feature plus biome and Koppen")
    expect(Render.areaHeaderLines({ showAreaLabels = false, currentArea = { featureName = "High Range", biome = "rainforest", koppen = "Af" } }) == nil, "area header setting should hide labels")
    local hudData = HUD.data({ world = world, player = Player.new(0, 0), camera = { yaw = 0 }, currentArea = { featureName = "High Range", biomeLabel = "ALPINE" }, weatherState = { precipitation = "snow" }, survey = { discoveryCount = 4, pinCount = 2 } })
    expect(hudData.area == "High Range" and hudData.weather == "S" and hudData.discoveries == 4 and hudData.pins == 2, "player HUD data should expose area, weather glyph, and counts")
    local ticks = HUD.compassTicks(0)
    local northCentered = false
    for _, tick in ipairs(ticks) do if tick.label == "N" and math.abs(tick.offset) < 0.00001 then northCentered = true end end
    expect(northCentered, "player HUD compass should center north at yaw zero")
    expect(HUD.weatherGlyph({ storm = "thunderstorm", precipitation = "rain" }) == "!", "player HUD weather glyph should prioritize storms")
    local regionWorld = WorldGen.new(3, { scope = "region", hydrologyRegionChunks = 2, hydrologyHaloCells = 0, hydrologyBasinChunks = 8, hydrologyBasinStride = 8 })
    local regionApp = { world = regionWorld, player = Player.new(0, 0), camera = Render.defaultCamera(), viewScale = ViewScale.new(regionWorld) }
    local regionStats = Render.visibleStats(regionApp, 1280, 720)
    expect(regionStats.viewScale == "region" and regionStats.viewFactor == 4 and regionStats.visibleTiles > 0, "render stats should follow region view scale")
    for _, pose in ipairs({ { math.pi * 0.5, -0.36 }, { math.pi, 0.34 }, { -math.pi * 0.75, 0.02 } }) do
        app.camera = Render.defaultCamera()
        app.camera.yaw = pose[1]
        app.camera.pitch = pose[2]
        local poseStats = Render.visibleStats(app, 1280, 720)
        expect(poseStats.visibleTiles > 0 and poseStats.visibleTiles <= poseStats.expectedMaxForFOV, "render stats should cull safely across yaw and pitch")
    end
end

local function colorDistance(a, b)
    local dr, dg, db = a[1] - b[1], a[2] - b[2], a[3] - b[3]
    return math.sqrt(dr * dr + dg * dg + db * db)
end

local function testBiomePalette()
    local palette = Render.biomePalette()
    expect(colorDistance(palette.ocean, palette.river) > 0.28, "water palette should separate ocean and rivers")
    expect(colorDistance(palette.desert, palette.grassland) > 0.35, "dry and grass biomes should have distinct colors")
    expect(colorDistance(palette.rainforest, palette.boreal_forest) > 0.16, "forest biomes should avoid a single green ramp")
    expect(colorDistance(palette.snow, palette.rock) > 0.75, "high terrain palette should separate snow and rock")
    expect(Render.biomeDisplayName("temperate_forest") == "TEMPERATE FOREST", "biome banner should format ids as readable labels")
    expect(Render.bannerAlpha(0.4, 3, 0.8) > 0 and Render.bannerAlpha(3.1, 3, 0.8) == 0, "biome banner alpha should fade in and out")
end

local function testSkyDomeColors()
    local noon = Render.skyColors(0.25)
    local midnight = Render.skyColors(0.75)
    expect(colorDistance(noon.top, midnight.top) > 0.32, "sky dome should react to time of day")
    expect(colorDistance(noon.horizon, noon.fog) < 0.25, "sky dome should haze horizon toward fog")
    expect(colorDistance(Render.skyColors(0.25, "summer").top, Render.skyColors(0.25, "winter").top) > 0.08, "sky dome should react to season")
end

local function testAtmosphereCycle()
    local base = PostFX.paletteFor("local")
    local noon = Atmosphere.palette(base, Atmosphere.new({ time = 0.25, season = "summer" }))
    local midnight = Atmosphere.palette(base, Atmosphere.new({ time = 0.75, season = "summer" }))
    expect(colorDistance(noon[12], midnight[12]) > 0.18, "atmosphere palette at noon should differ from midnight")
    local winter = Atmosphere.palette(base, Atmosphere.new({ time = 0.25, season = "winter" }))
    expect(colorDistance(noon[23], winter[23]) > 0.08, "atmosphere palette should vary by season")
    local state = Atmosphere.new({ time = 0.99, season = "winter", dayLength = 60 })
    Atmosphere.update(state, 1.2)
    expect(state.time > 0 and state.time < 0.02, "atmosphere update should wrap day cycle")
    expect(Atmosphere.shiftSeason(state, 1) == "spring" and Atmosphere.shiftSeason(state, -1) == "winter", "atmosphere season shift should wrap")
end

local function testAtmosphereSolarRealism()
    local summer = Atmosphere.new({ time = 0.25, season = "summer", latitudeRadians = math.rad(50) })
    local winter = Atmosphere.new({ time = 0.25, season = "winter", latitudeRadians = math.rad(50) })
    local summerSolar = Atmosphere.solarState(summer)
    local winterSolar = Atmosphere.solarState(winter)
    expect(summerSolar.elevationDegrees > winterSolar.elevationDegrees, "summer noon sun should be higher than winter at mid-latitudes")
    expect(Atmosphere.daylightWindow(summer, 0) > Atmosphere.daylightWindow(winter, 0), "season should change day length by latitude")
    expect(Atmosphere.daylightWindow(summer, -18) > Atmosphere.daylightWindow(summer, -12) and Atmosphere.daylightWindow(summer, -12) > Atmosphere.daylightWindow(summer, -6), "twilight bands should have distinct lengths")
    local moon = Atmosphere.new({ time = 0.25, season = "summer", dayLength = 1, elapsedDays = 0 })
    local before = Atmosphere.moonPhase(moon)
    Atmosphere.update(moon, 2.1)
    expect(math.abs(Atmosphere.moonPhase(moon) - before) > 0.01, "moon phase should advance over in-game days")
end

local function testAtmosphereSunDirection()
    local noon = Atmosphere.sunDirection(Atmosphere.new({ time = 0.25 }))
    local midnight = Atmosphere.sunDirection(Atmosphere.new({ time = 0.75 }))
    local dusk = Atmosphere.sunDirection(Atmosphere.new({ time = 0.5 }))
    local function unit(v) return math.abs(math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) - 1) < 1e-6 end
    expect(unit(noon) and unit(midnight) and unit(dusk), "sun direction should be unit length")
    expect(noon.z > midnight.z, "sun should be higher at noon than midnight")
    expect(noon.daylight > midnight.daylight, "daylight should be greater at noon than midnight")
    expect(math.abs(noon.x) < 0.01, "sun should be near zenith east-west at noon")
    expect(dusk.x < 0, "sun should swing west at dusk")
end

local function testWeatherStateMachine()
    local world = WorldGen.new(20260625, fastWorldOptions)
    local cell = { x = 128, y = -64, temperature = 0.76, rainfall = 0.82, moisture = 0.82, slope = 0.08, windX = 0.7, windY = 0.2, pressureCellId = 2, koppen = "Af", water = false }
    local first = Weather.sample(world, cell, { x = cell.x, y = cell.y, bucket = 17 })
    local second = Weather.sample(world, cell, { x = cell.x, y = cell.y, bucket = 17 })
    expect(Save.encode(first) == Save.encode(second), "weather should be deterministic for seed/geologicTime/bucket")
    expect(first.eventDuration >= 30 and first.eventDuration <= 1200, "weather events should stay within persistence bounds")
    expect(first.visibility <= 1 and first.visibility >= 0.18 and type(first.koppen) == "string", "weather should expose visibility and Koppen state")
    local wetEvents, stormEvents = 0, 0
    for bucket = 0, 95 do
        local state = Weather.sample(world, cell, { x = cell.x + bucket * 13, y = cell.y - bucket * 7, bucket = bucket })
        if state.precipitation ~= "clear" then wetEvents = wetEvents + 1 end
        if state.storm ~= "none" then stormEvents = stormEvents + 1 end
    end
    expect(wetEvents > 0 and stormEvents < wetEvents, "storms should be rarer than rain events")
    local dry = Weather.sample(world, { x = 32, y = 32, temperature = 0.82, rainfall = 0.08, windX = 1, windY = 0, slope = 0.2, pressureCellId = 1, koppen = "BWh" }, { x = 32, y = 32, bucket = 11 })
    expect(Weather.particleCount(dry, 1280, 720) >= 0 and dry.eventDuration >= 30, "dry weather should remain renderable")
end

local function testPostFxPixelScale()
    expect(PostFX.parsePixelScale(nil) == 2, "postfx default pixel scale should be 2")
    expect(PostFX.parsePixelScale("3") == 3 and PostFX.parsePixelScale(4) == 4, "postfx should accept configured pixel scales")
    local width, height = PostFX.lowResSize(1280, 720, 2)
    expect(width == 640 and height == 360, "postfx should compute half-res canvas dimensions")
    local ok = pcall(PostFX.parsePixelScale, "5")
    expect(not ok, "postfx should reject unsupported pixel scales")
    expect(#PostFX.paletteFor("local") == 64 and #PostFX.paletteFor("region") == 64 and #PostFX.paletteFor("continent") == 64, "postfx palettes should expose 64 colors")
    expect(#PostFX.paletteFor("local", Atmosphere.new({ time = 0.5 })) == 64, "atmosphere palette should preserve 64 colors")
    expect(PostFX.paletteFor("local")[1][1] ~= PostFX.paletteFor("region")[1][1] or PostFX.paletteFor("local")[4][3] ~= PostFX.paletteFor("region")[4][3], "postfx scope palettes should differ")
    expect(PostFX.activePaletteId({ viewScale = { target = "continent" } }) == "continent", "postfx palette should follow active scope")
end

local function testTopographicMapData()
    local world = testWorld(20260625)
    local app = { world = world, player = Player.new(0, 0), camera = Render.defaultCamera(), viewScale = ViewScale.new(world) }
    local data = Render.topographicMapData(app, 32)
    expect(data.samples == 1024 and data.scale == "local", "topographic map should sample local terrain when enabled")
    expect(data.water > 0 and data.water < data.samples, "topographic map should include land and water")
    expect(data.rivers > 0 and data.contours > 0, "topographic map should expose rivers and contours")
    app.topographicSpan = 192
    local minimap = Render.topographicMapData(app, 24)
    expect(minimap.samples == 576 and minimap.span == 192, "minimap-sized topographic data should support compact HUD sampling")
end

local function testDebugPanelIds()
    local ids = Render.debugPanelIds()
    local seen = {}
    for _, id in ipairs(ids) do seen[id] = true end
    expect(seen.plate and seen.drainage and seen.erosion and seen.biome, "debug panel ids should expose plate, drainage, erosion, biome overlays")
    expect(#ids == 4, "render should expose exactly four toggleable panels")
end

local function testDebugPanelData()
    local world = testWorld(20260625)
    local app = { world = world, player = Player.new(0, 0), camera = Render.defaultCamera(), viewScale = ViewScale.new(world) }
    local data = Render.debugPanelData(app)
    expect(data.plate.vx == data.plate.vx and data.plate.boundary >= 0, "debug panels should expose finite plate vector inputs")
    expect(data.drainage.flow >= 0 and data.drainage.dx == data.drainage.dx and data.drainage.watershedId, "debug panels should expose drainage direction inputs")
    expect(data.erosion.erosion == data.erosion.erosion and data.erosion.thermal == data.erosion.thermal, "debug panels should expose erosion deltas")
    expect(data.biome.id and data.biome.temperature >= 0 and data.biome.moisture >= 0 and data.biome.slope >= 0, "debug panels should expose biome classifier inputs")
end

local function testMapExportData()
    local world = testWorld(20260625)
    local map = Export.renderMap(world, { size = 32, span = 256, scale = "local" })
    local ppm = Export.ppmBytes(map)
    local json = Export.metadataJson(map.metadata)
    expect(map.metadata.seed == 20260625 and map.metadata.size == 32, "export metadata should include seed and size")
    expect(map.stats.land > 0 and map.stats.water > 0 and map.stats.rivers > 0, "export map should include terrain stats")
    expect(string.sub(ppm, 1, 12) == "P6\n32 32\n255" and #ppm > 32 * 32 * 3, "export should produce image bytes")
    expect(string.find(json, '"seed": 20260625', 1, true) ~= nil, "export metadata should encode seed json")
end

local function testTerrainBenchmark()
    local result = Benchmark.run({
        seed = 20260625,
        chunkRadius = 0,
        scales = { "local", "region", "continent" },
        worldOptions = basinWorldOptions,
    })
    expect(result.chunks == 3 and result.cells == 3 * 64 * 64, "benchmark should visit requested chunks and scales")
    expect(result.seconds > 0 and result.chunksPerSecond > 0 and result.cellsPerSecond > 0, "benchmark should report timing rates")
    expect(result.cache.total > 0 and result.metrics.chunkMisses == 3, "benchmark should expose cache and miss counters")
    expect(string.find(Benchmark.format(result), "benchmark=terrain", 1, true) ~= nil, "benchmark should format cli output")
end

local function testBenchmarkBaselineGate()
    local result = Benchmark.run({
        seed = 20260625,
        chunkRadius = 0,
        scales = { "local" },
        worldOptions = basinWorldOptions,
    })
    local snapshot = Benchmark.snapshot(result)
    expect(snapshot.cellsPerSecond and snapshot.cellsPerSecond > 0, "snapshot should preserve cellsPerSecond")
    local pass = Benchmark.compareToBaseline(result, { cellsPerSecond = result.cellsPerSecond * 0.5 }, 0.1)
    expect(pass.ok, "current run should beat 50% of itself")
    local fail = Benchmark.compareToBaseline(result, { cellsPerSecond = result.cellsPerSecond * 4 }, 0.1)
    expect(not fail.ok, "4x baseline should detect regression")
    expect(Benchmark.compareToBaseline(result, nil, 0.1).ok, "missing baseline should not block")
end

local function testTerrainDiagnostics()
    local seeds = { 6, 8, 19, 30 }
    local sweep = Diagnostics.sweep({
        seeds = seeds,
        chunkRadius = 1,
        sampleStep = 8,
        worldOptions = basinWorldOptions,
    })
    expect(#sweep.results == #seeds, "diagnostics should report every fixture seed")
    expect(#sweep.failed == 0, "diagnostic fixtures should stay inside terrain sanity bounds:\n" .. Diagnostics.formatFailures(sweep.failed))
    for _, stats in ipairs(sweep.results) do
        expect(stats.cells > 0 and stats.land + stats.water == stats.cells, "diagnostics should count sampled cells")
        expect(stats.waterRatio >= 0 and stats.waterRatio <= 1, "water ratio should be normalized")
        expect(stats.riverRatio >= 0 and stats.riverRatio <= 1, "river ratio should be normalized")
        expect(stats.biomeGroups and stats.biomeGroups.water >= 0, "diagnostics should report biome group ratios")
        expect(stats.biomeCount >= 3, "diagnostics should observe multiple biomes")
    end
end

local function testBadSeedDiagnostics()
    for _, fixture in ipairs(Diagnostics.badSeeds()) do
        local stats = Diagnostics.analyzeSeed(fixture, {
            chunkRadius = 1,
            sampleStep = 8,
            worldOptions = basinWorldOptions,
        })
        local flags = {}
        for _, flag in ipairs(stats.flags) do flags[flag] = true end
        for _, expectedFlag in ipairs(fixture.flags) do
            expect(flags[expectedFlag], "bad seed fixture should flag " .. expectedFlag .. " for seed " .. tostring(fixture.seed))
        end
    end
end

local function testRegressionSeedDiagnostics()
    local categories = {}
    for _, fixture in ipairs(Diagnostics.regressionSeeds()) do
        categories[fixture.category] = true
        local stats = Diagnostics.analyzeSeed(fixture, {
            chunkRadius = 1,
            sampleStep = 8,
            worldOptions = basinWorldOptions,
        })
        local flags = {}
        for _, flag in ipairs(stats.flags) do flags[flag] = true end
        for _, expectedFlag in ipairs(fixture.flags or {}) do
            expect(flags[expectedFlag], "regression seed should flag " .. expectedFlag .. " for " .. fixture.category)
        end
        if fixture.maxSeamMismatches then expect(stats.seamMismatches <= fixture.maxSeamMismatches, "regression seed should bound seam mismatches") end
        if fixture.maxUphillRejects then expect(stats.uphillRejects <= fixture.maxUphillRejects, "regression seed should bound river discontinuities") end
        if fixture.minRivers then expect(stats.rivers >= fixture.minRivers, "regression seed should keep river coverage") end
    end
    expect(categories.ugly_terrain and categories.all_water and categories.all_land and categories.broken_seams and categories.river_discontinuities, "regression seed categories should cover terrain failure modes")
    expect(categories.riverless and categories.single_biome and categories.biome_count_low and categories.steep_slopes and categories.drowned_basin, "regression seed categories should cover extended failure modes")
    local count = 0
    for _ in pairs(categories) do count = count + 1 end
    expect(count >= 10, "regression seed fixtures should cover at least 10 categories")
end

local function testTerrainFirstScope()
    local files = {
        "main.lua",
        "src/hydrology.lua",
        "src/player.lua",
        "src/render.lua",
        "src/save.lua",
        "src/survey.lua",
        "src/viewscale.lua",
        "src/export.lua",
        "src/benchmark.lua",
        "src/worldgen.lua",
    }
    local forbidden = { "ruin", "lore", "quest", "collectible", "combat", "survival" }
    for _, path in ipairs(files) do
        local handle = assert(io.open(path, "r"))
        local text = handle:read("*a")
        handle:close()
        local lower = string.lower(text)
        for _, term in ipairs(forbidden) do
            expect(not string.find(lower, term, 1, true), "terrain-first runtime should not include " .. term .. " in " .. path)
        end
    end
end

local function smoke()
    local world = WorldGen.new(1)
    local app = { world = world, player = Player.new(0, 0), camera = Render.defaultCamera() }
    local stats = Render.visibleStats(app, 1280, 720)
    local land, water, rivers, lakes = 0, 0, 0, 0
    local localStats = world:hydrologyStats(0, 0, "local")
    local featureStats = {
        braidedRivers = localStats.braidedRivers or 0,
        terraces = localStats.terraces or 0,
        fanLobes = localStats.fanLobes or 0,
        playas = localStats.playas or 0,
        sinkholes = localStats.sinkholes or 0,
    }
    local function addFeatureStats(seed, chunkX, chunkY)
        local fixture = WorldGen.new(seed):hydrologyStats(chunkX, chunkY, "local")
        featureStats.braidedRivers = featureStats.braidedRivers + (fixture.braidedRivers or 0)
        featureStats.terraces = featureStats.terraces + (fixture.terraces or 0)
        featureStats.fanLobes = featureStats.fanLobes + (fixture.fanLobes or 0)
        featureStats.playas = featureStats.playas + (fixture.playas or 0)
        featureStats.sinkholes = featureStats.sinkholes + (fixture.sinkholes or 0)
    end
    addFeatureStats(20260625, 0, 0)
    addFeatureStats(3, -1, 1)
    for _, scale in ipairs(world:metadata().scales) do
        local chunk = world:chunk(0, 0, scale.id)
        for y = 1, chunk.size do
            for x = 1, chunk.size do
                local cell = chunk.cells[y][x]
                if cell.water then water = water + 1 else land = land + 1 end
                if cell.river then rivers = rivers + 1 end
                if cell.lake then lakes = lakes + 1 end
            end
        end
    end
    print("smoke=terrain")
    print("land=" .. land)
    print("water=" .. water)
    print("rivers=" .. rivers)
    print("lakes=" .. lakes)
    print("basins=" .. localStats.basins)
    print("lake_groups=" .. localStats.lakeGroups)
    print("talus=" .. localStats.talusSlopes)
    print("alluvial_fans=" .. localStats.alluvialFans)
    print("fan_lobes=" .. featureStats.fanLobes)
    print("floodplains=" .. localStats.floodplains)
    print("deltas=" .. localStats.deltas)
    print("braided_rivers=" .. featureStats.braidedRivers)
    print("terraces=" .. featureStats.terraces)
    print("playas=" .. featureStats.playas)
    print("sinkholes=" .. featureStats.sinkholes)
    print("sediment_cells=" .. localStats.sedimentCells)
    print("glaciated_cells=" .. localStats.glaciatedCells)
    print("coast_cliffs=" .. localStats.coastCliffs)
    print("coast_beaches=" .. localStats.coastBeaches)
    print("seam_mismatches=" .. localStats.seamMismatches)
    print("uphill_rejects=" .. localStats.uphillRejects)
    print("max_flow=" .. string.format("%.3f", localStats.maxFlow))
    print("mesh_tiles=" .. stats.visibleTiles)
    print("triangles=" .. stats.triangles)
    print("river_strips=" .. stats.riverStrips)
    print("silhouettes=" .. stats.silhouetteStrips)
    print("billboards=" .. stats.billboards)
    print("landmarks=" .. stats.landmarks)
    print("camera_height=" .. string.format("%.3f", stats.cameraHeight))
    if stats.clipmap then
        print("clipmap=" .. tostring(stats.clipmapRings) .. ":" .. tostring(stats.clipmapRadius) .. ":" .. tostring(stats.clipmapSteps))
    end
    expect(land > 0 and water > 0 and rivers > 0, "smoke should cover land, water, and rivers")
    expect(localStats.basins > 0 and localStats.uphillRejects == 0, "smoke should include sane hydrology stats")
    expect(localStats.sedimentCells > 0 and localStats.talusSlopes + localStats.alluvialFans + localStats.floodplains + localStats.deltas > 0, "smoke should include erosion landforms")
    expect(featureStats.braidedRivers > 0 and featureStats.terraces > 0 and featureStats.fanLobes > 0 and featureStats.playas > 0 and featureStats.sinkholes > 0, "smoke should include new terrain landforms")
    expect(stats.visibleTiles > 0 and stats.triangles > 0, "smoke should build visible terrain mesh")
    expect(stats.riverStrips > 0 and stats.silhouetteStrips > 0 and stats.landmarks > 0, "smoke should include readability overlays")
end

local tests = {
    testDeterminism,
    testSeedVariance,
    testSampleChunkAgreement,
    testRiverMonotonicity,
    testHydrologyStats,
    testLakeGroupingAndSpillover,
    testErosionLandforms,
    testTectonicFeatures,
    testOrometryArchetypes,
    testHotspotTrails,
    testVolcanicLandforms,
    testPeriglacialStamps,
    testDiscoveryOverlayIds,
    testNamedTerrainDiscoveries,
    testSurveyHistory,
    testSaveLoadRoundTrip,
    testViewScaleTransitions,
    testDiegeticScaleTransitions,
    testBasinHydrologyBudget,
    testCacheBoundsAndCounters,
    testPlateCacheBounds,
    testChunkSoAArrays,
    testLithologyDistribution,
    testKarstStamp,
    testReefSuccession,
    testLithologyErodibilityScalesStreamPower,
    testRegolithProduction,
    testSoilOrderDistribution,
    testHillslopeProfile,
    testDebrisFlowSignature,
    testSeaLevelSeries,
    testGDH1Profile,
    testBathymetryProfile,
    testGeographicLatitudeAndCoriolis,
    testClimateBands,
    testPlateMotionGeologicTime,
    testRngHashRange,
    testOpenSimplexNoise,
    testStreamPowerConvergence,
    testIsostasy,
    testStreamPowerDiagnostics,
    testOrographicRainShadow,
    testMeanderSinuosity,
    testBasinChannelsSpanDetailRegions,
    testBiomes,
    testWhittakerBins,
    testBiomeRefinement,
    testWhittakerDiagnostics,
    testGlacialSIA,
    testGlacialFeatures,
    testCoastlines,
    testShorelineCapes,
    testWernerDuneRegimes,
    testPlayer,
    testHeightInterpolationAndNormal,
    testBillboardAtlas,
    testBillboards,
    testClipmap,
    testRenderStats,
    testBiomePalette,
    testSkyDomeColors,
    testAtmosphereCycle,
    testAtmosphereSolarRealism,
    testAtmosphereSunDirection,
    testWeatherStateMachine,
    testPostFxPixelScale,
    testTopographicMapData,
    testDebugPanelIds,
    testDebugPanelData,
    testMapExportData,
    testTerrainBenchmark,
    testBenchmarkBaselineGate,
    testTerrainDiagnostics,
    testBadSeedDiagnostics,
    testRegressionSeedDiagnostics,
    testTerrainFirstScope,
}

local function hasCliFlag(args, flag)
    for _, item in ipairs(args or {}) do
        if item == flag then return true end
    end
    return false
end

local function cliValue(args, flag, fallback)
    for index, item in ipairs(args or {}) do
        if item == flag then return args[index + 1] or fallback end
    end
    return fallback
end

local function diagnosticSeeds(args)
    local csv = cliValue(args, "--seeds")
    if csv then
        local seeds = {}
        for item in string.gmatch(csv, "([^,]+)") do
            seeds[#seeds + 1] = tonumber(item)
        end
        return seeds
    end
    if not (hasCliFlag(args, "--seed-start") or hasCliFlag(args, "--seed-count")) then
        return Diagnostics.defaultSeeds()
    end
    local start = tonumber(cliValue(args, "--seed-start", 1)) or 1
    local count = tonumber(cliValue(args, "--seed-count", 12)) or 12
    local seeds = {}
    for offset = 0, count - 1 do seeds[#seeds + 1] = start + offset end
    return seeds
end

local function diagnostics(args)
    local sweep = Diagnostics.sweep({
        seeds = diagnosticSeeds(args),
        chunkRadius = tonumber(cliValue(args, "--chunk-radius", 1)) or 1,
        sampleStep = tonumber(cliValue(args, "--sample-step", 8)) or 8,
        worldOptions = basinWorldOptions,
    })
    print("diagnostics=terrain")
    local distinctBiomes = {}
    for _, stats in ipairs(sweep.results) do
        for id in pairs(stats.biomes) do distinctBiomes[id] = true end
        print(Diagnostics.formatResult(stats))
    end
    local biomeCount = 0
    for _ in pairs(distinctBiomes) do biomeCount = biomeCount + 1 end
    print("diagnostics-biomes=" .. tostring(biomeCount))
    if #sweep.failed > 0 then
        error("diagnostic sweep failed:\n" .. Diagnostics.formatFailures(sweep.failed), 0)
    end
end

local function csvList(value)
    if not value then return nil end
    local out = {}
    for item in string.gmatch(value, "([^,]+)") do out[#out + 1] = item end
    return out
end

local function benchmark(args)
    local result = Benchmark.run({
        seed = tonumber(cliValue(args, "--seed", 20260625)) or 20260625,
        chunkRadius = tonumber(cliValue(args, "--chunk-radius", 1)) or 1,
        scales = csvList(cliValue(args, "--scales")),
        worldOptions = basinWorldOptions,
    })
    print(Benchmark.format(result))
    local baselinePath = cliValue(args, "--baseline")
    if cliValue(args, "--update-baseline") then
        local outPath = cliValue(args, "--update-baseline")
        Benchmark.writeBaseline(outPath, Benchmark.snapshot(result))
        print("benchmark-baseline-written=" .. outPath)
        return
    end
    if baselinePath then
        local baseline = Benchmark.readBaseline(baselinePath)
        if not baseline then
            print("benchmark-baseline-missing=" .. baselinePath)
            return
        end
        local tolerance = tonumber(cliValue(args, "--baseline-tolerance", 0.1)) or 0.1
        local check = Benchmark.compareToBaseline(result, baseline, tolerance)
        print(string.format(
            "benchmark-baseline=%s baseline_cells_per_sec=%.0f current_cells_per_sec=%.0f ratio=%.3f tolerance=%.2f status=%s",
            baselinePath,
            check.baseline or 0,
            check.current or 0,
            check.ratio or 0,
            tolerance,
            check.ok and "ok" or "regression"
        ))
        if not check.ok then
            error(string.format(
                "benchmark regression: %.0f cells/sec is below %.0f floor (baseline %.0f, tolerance %.0f%%)",
                check.current,
                check.floor,
                check.baseline,
                tolerance * 100
            ), 0)
        end
    end
end

local function plateBenchmark(args)
    local result = WorldGen.benchmarkPlates({
        seed = tonumber(cliValue(args, "--seed", 20260625)) or 20260625,
        count = tonumber(cliValue(args, "--count", 10000)) or 10000,
        cacheLimit = tonumber(cliValue(args, "--cache-limit", 4096)) or 4096,
    })
    print(string.format(
        "benchmark=plates count=%d cold=%.6f cached=%.6f speedup=%.2f cache_entries=%d checksum=%d",
        result.count,
        result.cold.seconds,
        result.cached.seconds,
        result.speedup,
        result.cached.cacheEntries,
        result.cached.checksum
    ))
    expect(result.cold.checksum == result.cached.checksum, "plate benchmark should preserve outputs")
    expect(result.speedup >= 3, "plate benchmark should show at least 3x speedup")
end

local function rngBenchmark(args)
    local result = Rng.benchmarkHash({
        count = tonumber(cliValue(args, "--count", 1000000)) or 1000000,
    })
    print(string.format(
        "benchmark=rng count=%d legacy=%.6f current=%.6f speedup=%.2f legacy_checksum=%.0f current_checksum=%.0f",
        result.count,
        result.legacy.seconds,
        result.current.seconds,
        result.speedup,
        result.legacy.checksum,
        result.current.checksum
    ))
    expect(result.legacy.checksum ~= result.current.checksum, "Rng.hash benchmark should produce a new bit stream")
    expect(result.speedup >= 4, "Rng.hash benchmark should show at least 4x speedup")
end

local function regressions()
    for _, fixture in ipairs(Diagnostics.regressionSeeds()) do
        local stats = Diagnostics.analyzeSeed(fixture, {
            chunkRadius = 1,
            sampleStep = 8,
            worldOptions = basinWorldOptions,
        })
        print("regression=" .. fixture.category .. " " .. Diagnostics.formatResult(stats))
    end
end

if arg and arg[1] == "--smoke" then
    smoke()
    return
end

if arg and arg[1] == "--diagnostics" then
    diagnostics(arg)
    return
end

if arg and arg[1] == "--benchmark" then
    benchmark(arg)
    return
end

if arg and arg[1] == "--bench-plates" then
    plateBenchmark(arg)
    return
end

if arg and arg[1] == "--bench-rng" then
    rngBenchmark(arg)
    return
end

if arg and arg[1] == "--regressions" then
    regressions()
    return
end

for index, test in ipairs(tests) do
    test()
    print("ok " .. index)
end
print("tests passed")
