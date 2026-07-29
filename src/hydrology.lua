local Erosion = require("src.erosion")
local Climate = require("src.climate")
local Coast = require("src.coast")
local SoilProduction = require("src.soil_production")
local Hillslope = require("src.hillslope")
local Meander = require("src.meander")
local Karst = require("src.karst")
local Volcano = require("src.volcano")
local Bathymetry = require("src.bathymetry")
local Reef = require("src.reef")

local Hydrology = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
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

local Heap = {}
Heap.__index = Heap

function Heap.new()
    return setmetatable({ items = {} }, Heap)
end

function Heap:push(cell, priority)
    local items = self.items
    local item = { cell = cell, priority = priority }
    items[#items + 1] = item
    local index = #items
    while index > 1 do
        local parent = math.floor(index / 2)
        if items[parent].priority <= item.priority then break end
        items[index] = items[parent]
        index = parent
    end
    items[index] = item
end

function Heap:pop()
    local items = self.items
    local root = items[1]
    if not root then return nil end
    local last = items[#items]
    items[#items] = nil
    if #items > 0 then
        local index = 1
        while true do
            local left = index * 2
            local right = left + 1
            if left > #items then break end
            local child = left
            if right <= #items and items[right].priority < items[left].priority then child = right end
            if items[child].priority >= last.priority then break end
            items[index] = items[child]
            index = child
        end
        items[index] = last
    end
    return root.cell
end

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

local function riverThreshold(scaleId)
    if scaleId == "local" then return 82 end
    if scaleId == "region" then return 46 end
    return 24
end

local function currentSeaLevel(world)
    if world.seaLevelAt then return world:seaLevelAt(world.geologicTime) end
    return world.seaLevel or 0
end

local function applyPaleoSeaLevel(world, visitOrder, threshold, seaLevel)
    local paleoMax = world.seaLevelPaleoMax or seaLevel
    local paleoMin = world.seaLevelPaleoMin or seaLevel
    local seaDrop = math.max(0, paleoMax - seaLevel)
    for _, cell in ipairs(visitOrder) do
        local elevation = cell.elevation or cell.elevationBase or 0
        cell.marineTerrace = 0
        cell.fluvialTerrace = 0
        cell.paleoShoreline = false
        cell.riverHistorical = false
        if not cell.water and elevation < paleoMax then
            cell.marineTerrace = paleoMax - elevation
            cell.paleoShoreline = true
        end
        local historicalChannel = cell.river or cell.macroChannelId ~= nil or (cell.flow or 0) > threshold * 0.35
        if cell.water and historicalChannel and (cell.elevationBase or elevation) <= paleoMax + 0.03 and (cell.elevationBase or elevation) >= paleoMin - 0.12 then
            cell.paleoShoreline = true
            cell.riverHistorical = true
        end
        if cell.river and cell.downCell then
            local distance = math.max(1, cell.downDistance or 1)
            local drop = math.max(0, elevation - (cell.downCell.elevation or cell.downCell.elevationBase or elevation))
            cell.fluvialTerrace = math.max(0, drop - 0.0005 * distance + seaDrop * 0.15)
        end
        if not cell.water and (cell.floodplain or cell.alluvialFan or cell.riverBank) and seaDrop > 0 and elevation > seaLevel + 0.02 and elevation < paleoMax + 0.18 then
            cell.fluvialTerrace = math.max(cell.fluvialTerrace, seaDrop * 0.08 + (cell.sediment or 0) * 0.2)
            cell.riverHistorical = true
        end
    end
end

local function unitStep(value)
    if value > 0 then return 1 end
    if value < 0 then return -1 end
    return 0
end

local function markFanLobe(region, target)
    if not target or target.water then return 0 end
    if (target.slope or 0) > 0.18 then return 0 end
    if target.alluvialFanLobe then return 0 end
    target.alluvialFanLobe = true
    target.deposition = math.max(target.deposition or 0, (target.sediment or 0) * 1.35)
    return 1
end

local function applyFanLobes(region, visitOrder)
    local lobes = 0
    for _, cell in ipairs(visitOrder) do
        if cell.alluvialFan then
            lobes = lobes + markFanLobe(region, cell)
            local dx, dy = 0, 1
            if cell.downCell then
                dx = unitStep((cell.downCell.gx or cell.gx) - cell.gx)
                dy = unitStep((cell.downCell.gy or cell.gy) - cell.gy)
                if dx == 0 and dy == 0 then dy = 1 end
            end
            local px, py = -dy, dx
            local candidates = {
                { dx, dy },
                { dx + px, dy + py },
                { dx - px, dy - py },
                { px, py },
                { -px, -py },
            }
            for _, offset in ipairs(candidates) do
                local target = region.cells[key(cell.gx + offset[1], cell.gy + offset[2])]
                lobes = lobes + markFanLobe(region, target)
            end
        end
    end
    return lobes
end

local function applyBraidedRivers(visitOrder, threshold)
    local braided = 0
    for _, cell in ipairs(visitOrder) do
        local sedimentLoad = (cell.sedimentFlux or 0) + (cell.sediment or 0)
        local capacity = math.max(cell.sedimentCapacity or 0, 0.0001)
        local overloaded = sedimentLoad > capacity * 1.15 and sedimentLoad > 0.0012
        cell.braidedRiver = cell.river and not cell.water and overloaded and (cell.slope or 0) >= 0.025 and (cell.slope or 0) < 0.2 and (cell.flow or 0) > threshold * 0.85
        if cell.braidedRiver then
            braided = braided + 1
            cell.deposition = math.max(cell.deposition or 0, (cell.sediment or 0) * 1.2)
        end
    end
    return braided
end

local function regionIndex(chunkCoord, regionChunks)
    local offset = math.floor(regionChunks / 2)
    return floorDiv(chunkCoord + offset, regionChunks)
end

local function regionStart(regionCoord, regionChunks)
    local offset = math.floor(regionChunks / 2)
    return regionCoord * regionChunks - offset
end

local function regionCacheKey(info, regionX, regionY)
    return key("hydrology", info.id, regionX, regionY)
end

local function basinCacheKey(info, regionX, regionY, stride)
    return key("basin", info.id, stride, regionX, regionY)
end

local function streamPowerKey(info, gx, gy)
    return key(info.id, gx, gy)
end

local function iceFieldKey(info, regionX, regionY)
    return key("ice", info.id, regionX, regionY)
end

local function boundaryCell(region, gx, gy)
    return region.cells[key(gx, gy)]
end

local function terminal(cell)
    if cell.terminalCell then return cell.terminalCell end
    local cursor = cell
    local path = {}
    local guard = 0
    while cursor.downCell and guard < 200000 do
        if cursor.terminalCell then
            cursor = cursor.terminalCell
            break
        end
        path[#path + 1] = cursor
        cursor = cursor.downCell
        guard = guard + 1
    end
    for _, item in ipairs(path) do
        item.terminalCell = cursor
    end
    cell.terminalCell = cursor
    return cursor
end

local function lakeOutlet(cell)
    if cell.lakeOutletCell ~= nil then return cell.lakeOutletCell end
    local cursor = cell.downCell
    local path = { cell }
    local guard = 0
    while cursor and cursor.lake and guard < 200000 do
        if cursor.lakeOutletCell ~= nil then
            cursor = cursor.lakeOutletCell
            break
        end
        path[#path + 1] = cursor
        cursor = cursor.downCell
        guard = guard + 1
    end
    for _, item in ipairs(path) do
        item.lakeOutletCell = cursor
    end
    return cursor
end

local function addBoundary(region, heap, visitOrder, cell)
    if cell.hydroVisited then return end
    cell.hydroVisited = true
    cell.filledElevation = cell.elevationBase
    visitOrder[#visitOrder + 1] = cell
    heap:push(cell, cell.filledElevation)
end

local function basinCenter(cell, stride)
    return cell.gx * stride + (stride - 1) * 0.5, cell.gy * stride + (stride - 1) * 0.5
end

local function pointSegmentDistance(px, py, ax, ay, bx, by)
    local vx, vy = bx - ax, by - ay
    local length2 = vx * vx + vy * vy
    if length2 <= 0 then
        local dx, dy = px - ax, py - ay
        return math.sqrt(dx * dx + dy * dy)
    end
    local t = clamp(((px - ax) * vx + (py - ay) * vy) / length2, 0, 1)
    local sx, sy = ax + vx * t, ay + vy * t
    local dx, dy = px - sx, py - sy
    return math.sqrt(dx * dx + dy * dy)
end

local function solveBasin(world, chunkX, chunkY, info)
    local basinChunks = world.hydrologyBasinChunks or 0
    local stride = math.max(1, world.hydrologyBasinStride or 1)
    if basinChunks <= 0 or stride <= 1 then return nil end
    local seaLevel = currentSeaLevel(world)
    local regionX = regionIndex(chunkX, basinChunks)
    local regionY = regionIndex(chunkY, basinChunks)
    local cacheKey = basinCacheKey(info, regionX, regionY, stride)
    local cached = world.cacheGet and world:cacheGet(cacheKey) or world.cache[cacheKey]
    if cached then return cached end
    if world.metrics then world.metrics.basinMisses = world.metrics.basinMisses + 1 end

    local chunkSize = world.chunkSize
    local startChunkX = regionStart(regionX, basinChunks)
    local startChunkY = regionStart(regionY, basinChunks)
    local interiorMinX = floorDiv(startChunkX * chunkSize, stride)
    local interiorMinY = floorDiv(startChunkY * chunkSize, stride)
    local interiorMaxX = floorDiv((startChunkX + basinChunks) * chunkSize - 1, stride)
    local interiorMaxY = floorDiv((startChunkY + basinChunks) * chunkSize - 1, stride)
    local halo = math.floor((world.hydrologyBasinHaloCells or 0) / stride)
    local minX = interiorMinX - halo
    local minY = interiorMinY - halo
    local maxX = interiorMaxX + halo
    local maxY = interiorMaxY + halo
    local threshold = riverThreshold(info.id) * math.max(1, stride * stride * 0.18)
    local region = {
        id = key("basin", info.id, regionX, regionY),
        scale = info.id,
        scaleFactor = info.factor,
        regionX = regionX,
        regionY = regionY,
        stride = stride,
        threshold = threshold,
        minX = minX,
        minY = minY,
        maxX = maxX,
        maxY = maxY,
        cells = {},
    }
    if world.metrics then world.metrics.basinCells = world.metrics.basinCells + (maxX - minX + 1) * (maxY - minY + 1) end

    world.streamPowerSampleDepth = (world.streamPowerSampleDepth or 0) + 1
    world.climateSampleDepth = (world.climateSampleDepth or 0) + 1
    for gy = minY, maxY do
        for gx = minX, maxX do
            local sampleGX = gx * stride + (stride - 1) * 0.5
            local sampleGY = gy * stride + (stride - 1) * 0.5
            local cell = world:baseSample(sampleGX * info.factor, sampleGY * info.factor, info.id)
            cell.gx = gx
            cell.gy = gy
            cell.filledElevation = cell.elevationBase
            cell.flow = math.max(0.01, cell.rainfall or 0) * stride * stride
            cell.water = cell.elevationBase <= seaLevel
            cell.river = false
            region.cells[key(gx, gy)] = cell
        end
    end
    world.streamPowerSampleDepth = world.streamPowerSampleDepth - 1
    world.climateSampleDepth = world.climateSampleDepth - 1

    Climate.solveRegion(world, region)
    for _, cell in pairs(region.cells) do
        cell.flow = math.max(0.01, cell.rainfall or cell.precipitation or 0) * stride * stride
    end
    region.soilProduction = SoilProduction.step(region, { dt = world.geologicTimeStep })

    local heap = Heap.new()
    local visitOrder = {}
    for gx = minX, maxX do
        addBoundary(region, heap, visitOrder, boundaryCell(region, gx, minY))
        addBoundary(region, heap, visitOrder, boundaryCell(region, gx, maxY))
    end
    for gy = minY + 1, maxY - 1 do
        addBoundary(region, heap, visitOrder, boundaryCell(region, minX, gy))
        addBoundary(region, heap, visitOrder, boundaryCell(region, maxX, gy))
    end

    while true do
        local cell = heap:pop()
        if not cell then break end
        for _, offset in ipairs(neighbors) do
            local nextCell = region.cells[key(cell.gx + offset.x, cell.gy + offset.y)]
            if nextCell and not nextCell.hydroVisited then
                nextCell.hydroVisited = true
                nextCell.downCell = cell
                nextCell.downDistance = offset.distance * stride * info.factor
                nextCell.filledElevation = math.max(nextCell.elevationBase, cell.filledElevation)
                visitOrder[#visitOrder + 1] = nextCell
                heap:push(nextCell, nextCell.filledElevation)
            end
        end
    end

    for index = #visitOrder, 1, -1 do
        local cell = visitOrder[index]
        if cell.downCell then
            cell.downCell.flow = cell.downCell.flow + cell.flow * 0.985
        end
    end
    if (world.geologicTimeStep or 0) > 0 and (world.hillslopeIterations or 0) > 0 then
        region.hillslope = Hillslope.diffuse(region, {
            D = world.hillslopeD,
            Sc = world.hillslopeSc,
            dt = world.geologicTimeStep,
            iterations = world.hillslopeIterations,
        })
    else
        region.hillslope = { moved = 0, cells = 0, maxSlopeRatio = 0, transitionFaces = 0 }
    end

    region.visitOrder = visitOrder
    region.seaLevel = seaLevel
    region.erosion = Erosion.relax(region, {
        iterations = world.streamPowerIterations,
        K = world.streamPowerK,
        m = world.streamPowerM,
        n = world.streamPowerN,
        uplift = world.streamPowerUplift,
        isostasy = world.streamPowerIsostasy,
        isostasyRatio = world.streamPowerIsostasyRatio,
        isostasyRadius = world.streamPowerIsostasyRadius,
        debrisK = world.debrisK,
        debrisCriticalConcentration = world.debrisCriticalConcentration,
        debrisSedimentYield = world.debrisSedimentYield,
    })
    local iceKey = iceFieldKey(info, regionX, regionY)
    local iceState = world.iceField and world.iceField:get(iceKey) or nil
    region.glaciers = Erosion.glaciate(region, {
        freezeTemperature = world.glacialFreezeTemperature,
        snowline = world.glacialSnowline,
        minFlow = world.glacialMinFlow,
        maxCut = world.glacialMaxCut,
        seaLevel = seaLevel,
        geologicTimeStep = world.geologicTimeStep,
        Gamma = world.glacialGamma,
        beta = world.glacialBeta,
        bmax = world.glacialBmax,
        Kg = world.glacialKg,
        siaIterations = world.glacialSiaIterations,
        iceState = iceState,
    })
    if world.iceField and region.glaciers.iceState then world.iceField:set(iceKey, region.glaciers.iceState) end
    local streamPowerSamples = world.streamPowerSamples
    if streamPowerSamples then
        for _, cell in ipairs(visitOrder) do
            streamPowerSamples[streamPowerKey(info, cell.gx, cell.gy)] = {
                delta = cell.streamPowerDelta or 0,
                sediment = cell.sediment or 0,
                isostaticRebound = cell.isostaticRebound or 0,
                glacialDelta = cell.glacialDelta or 0,
                glaciated = cell.glaciated and 1 or 0,
                iceThickness = cell.iceThickness or 0,
                hillslopeDelta = cell.hillslopeDelta or 0,
                debrisFlowDelta = cell.debrisFlowDelta or 0,
                debrisFlow = cell.debrisFlow and 1 or 0,
            }
        end
    end

    local stats = { rivers = 0, basins = 0, maxFlow = 0, streamPowerMaxDelta = region.erosion.maxDelta or 0, streamPowerMeanErosion = region.erosion.meanErosion or 0, maxSediment = region.erosion.maxSediment or 0, debrisFlowCells = region.erosion.debrisFlowCells or 0, glaciatedCells = region.glaciers.glaciatedCells or 0, glacialIceVolume = region.glaciers.iceVolume or 0 }
    local basinIds = {}
    for _, cell in ipairs(visitOrder) do
        local root = terminal(cell)
        cell.basinId = key("mb", info.id, root.gx, root.gy)
        basinIds[cell.basinId] = true
        cell.water = cell.elevation <= seaLevel
        cell.river = not cell.water and cell.downCell ~= nil and cell.flow > threshold
        if cell.downCell then
            cell.channelId = key("mc", info.id, cell.gx, cell.gy, cell.downCell.gx, cell.downCell.gy)
        end
        if cell.river then stats.rivers = stats.rivers + 1 end
        if cell.flow > stats.maxFlow then stats.maxFlow = cell.flow end
    end
    for _ in pairs(basinIds) do stats.basins = stats.basins + 1 end
    region.stats = stats
    if world.cachePut then return world:cachePut(cacheKey, region, "basin") end
    world.cache[cacheKey] = region
    return region
end

local function basinFlowFor(world, gx, gy, info)
    local stride = math.max(1, world.hydrologyBasinStride or 1)
    if (world.hydrologyBasinChunks or 0) <= 0 or stride <= 1 then return 0, nil, 0 end
    local chunkX = floorDiv(gx, world.chunkSize)
    local chunkY = floorDiv(gy, world.chunkSize)
    local basin = solveBasin(world, chunkX, chunkY, info)
    if not basin then return 0, nil, 0 end
    local cell = basin.cells[key(floorDiv(gx, stride), floorDiv(gy, stride))]
    if not (cell and cell.river and cell.downCell) then return 0, cell, 0 end
    local ax, ay = basinCenter(cell, stride)
    local bx, by = basinCenter(cell.downCell, stride)
    local distance = pointSegmentDistance(gx, gy, ax, ay, bx, by)
    local width = math.max(0.75, math.min(2.25, stride * 0.28))
    local weight = clamp(1 - distance / width, 0, 1)
    if weight <= 0 then return 0, cell, 0 end
    local scale = world.hydrologyBasinFlowScale or 0.6
    local flow = math.max(0, cell.flow - basin.threshold) / math.max(1, stride * stride)
    return flow * scale * weight, cell, weight
end

local function labelLakeGroups(region, visitOrder, info)
    local groups = {}
    local seen = {}
    for _, start in ipairs(visitOrder) do
        local startKey = key(start.gx, start.gy)
        if start.lake and not seen[startKey] then
            local stack = { start }
            local cells = {}
            local outlet
            local surface = start.lakeSurface or start.filledElevation
            local maxDepth = 0
            local maxFlow = 0
            seen[startKey] = true
            while #stack > 0 do
                local cell = stack[#stack]
                stack[#stack] = nil
                cells[#cells + 1] = cell
                surface = math.max(surface or 0, cell.lakeSurface or cell.filledElevation or 0)
                maxDepth = math.max(maxDepth, cell.lakeDepth or 0)
                maxFlow = math.max(maxFlow, cell.flow or 0)
                local candidate = lakeOutlet(cell)
                if candidate and (not outlet or (candidate.filledElevation or candidate.elevationBase or 0) < (outlet.filledElevation or outlet.elevationBase or 0)) then
                    outlet = candidate
                end
                for _, offset in ipairs(neighbors) do
                    local neighbor = region.cells[key(cell.gx + offset.x, cell.gy + offset.y)]
                    if neighbor and neighbor.lake then
                        local neighborKey = key(neighbor.gx, neighbor.gy)
                        if not seen[neighborKey] then
                            seen[neighborKey] = true
                            stack[#stack + 1] = neighbor
                        end
                    end
                end
            end
            local anchor = outlet or cells[1]
            local groupId = key("lg", info.id, math.floor((surface or 0) * 10000 + 0.5), anchor.gx, anchor.gy)
            local group = {
                id = groupId,
                cells = cells,
                outlet = outlet,
                surface = surface,
                maxDepth = maxDepth,
                maxFlow = maxFlow,
            }
            groups[#groups + 1] = group
            for _, cell in ipairs(cells) do
                cell.lakeId = groupId
                cell.lakeGroupSize = #cells
                cell.lakeMaxDepth = maxDepth
                cell.spilloverElevation = surface
                cell.spilloverFlow = maxFlow
                if outlet then
                    cell.outletX = outlet.x
                    cell.outletY = outlet.y
                    cell.lakeOutletX = outlet.x
                    cell.lakeOutletY = outlet.y
                end
            end
            if outlet then
                outlet.spillover = true
                outlet.spilloverLakeId = groupId
                outlet.spilloverElevation = surface
                outlet.spilloverFlow = math.max(outlet.spilloverFlow or 0, maxFlow)
            end
        end
    end
    return groups
end

local function solveRegion(world, chunkX, chunkY, info)
    local regionChunks = world.hydrologyRegionChunks or 4
    local regionX = regionIndex(chunkX, regionChunks)
    local regionY = regionIndex(chunkY, regionChunks)
    local seaLevel = currentSeaLevel(world)
    local cacheKey = regionCacheKey(info, regionX, regionY)
    local cached = world.cacheGet and world:cacheGet(cacheKey) or world.cache[cacheKey]
    if cached then return cached end
    if world.metrics then world.metrics.hydrologyMisses = world.metrics.hydrologyMisses + 1 end

    local chunkSize = world.chunkSize
    local startChunkX = regionStart(regionX, regionChunks)
    local startChunkY = regionStart(regionY, regionChunks)
    local interiorMinX = startChunkX * chunkSize
    local interiorMinY = startChunkY * chunkSize
    local interiorMaxX = interiorMinX + regionChunks * chunkSize - 1
    local interiorMaxY = interiorMinY + regionChunks * chunkSize - 1
    local halo = world.hydrologyHaloCells or math.floor(chunkSize / 2)
    local minX = interiorMinX - halo
    local minY = interiorMinY - halo
    local maxX = interiorMaxX + halo
    local maxY = interiorMaxY + halo
    local region = {
        id = key(info.id, regionX, regionY),
        scale = info.id,
        scaleFactor = info.factor,
        regionX = regionX,
        regionY = regionY,
        startChunkX = startChunkX,
        startChunkY = startChunkY,
        interiorMinX = interiorMinX,
        interiorMinY = interiorMinY,
        interiorMaxX = interiorMaxX,
        interiorMaxY = interiorMaxY,
        minX = minX,
        minY = minY,
        maxX = maxX,
        maxY = maxY,
        seaLevel = seaLevel,
        cells = {},
    }
    if world.metrics then world.metrics.hydrologyCells = world.metrics.hydrologyCells + (maxX - minX + 1) * (maxY - minY + 1) end

    for gy = minY, maxY do
        for gx = minX, maxX do
            local basinFlow, basinCell, basinWeight = basinFlowFor(world, gx, gy, info)
            local cell = world:baseSample(gx * info.factor, gy * info.factor, info.id)
            cell.gx = gx
            cell.gy = gy
            cell.hydrologyRegion = region.id
            cell.filledElevation = cell.elevationBase
            cell.flow = math.max(0.01, cell.rainfall or 0) + basinFlow
            cell.basinFlow = basinCell and basinCell.flow or 0
            cell.macroBasinId = basinCell and basinCell.basinId or nil
            cell.macroChannelId = basinWeight > 0 and basinCell and basinCell.channelId or nil
            cell.macroChannelWeight = basinWeight
            cell.erosion = 0
            cell.deposition = 0
            cell.thermalErosion = 0
            cell.talus = false
            cell.alluvialFan = false
            cell.alluvialFanLobe = false
            cell.floodplain = false
            cell.delta = false
            cell.braidedRiver = false
            cell.playa = false
            cell.river = false
            cell.riverBank = false
            cell.lake = false
            cell.lakeDepth = 0
            cell.lakeSurface = nil
            region.cells[key(gx, gy)] = cell
        end
    end
    region.karst = Karst.applyRegion(region, { seed = world.seed, seaLevel = seaLevel, stride = 1 })
    region.volcanoes = Volcano.applyRegion(region, {
        seed = world.seed,
        seaLevel = seaLevel,
        arcThreshold = world.volcanicArcThreshold,
        hotspotThreshold = world.volcanicHotspotThreshold,
    })
    for _, cell in pairs(region.cells) do
        cell.filledElevation = cell.elevationBase
    end

    local heap = Heap.new()
    local visitOrder = {}
    for gx = minX, maxX do
        addBoundary(region, heap, visitOrder, boundaryCell(region, gx, minY))
        addBoundary(region, heap, visitOrder, boundaryCell(region, gx, maxY))
    end
    for gy = minY + 1, maxY - 1 do
        addBoundary(region, heap, visitOrder, boundaryCell(region, minX, gy))
        addBoundary(region, heap, visitOrder, boundaryCell(region, maxX, gy))
    end

    while true do
        local cell = heap:pop()
        if not cell then break end
        for _, offset in ipairs(neighbors) do
            local nextCell = region.cells[key(cell.gx + offset.x, cell.gy + offset.y)]
            if nextCell and not nextCell.hydroVisited then
                nextCell.hydroVisited = true
                nextCell.downCell = cell
                nextCell.downX = cell.x
                nextCell.downY = cell.y
                nextCell.downDistance = offset.distance * info.factor
                nextCell.filledElevation = math.max(nextCell.elevationBase, cell.filledElevation)
                visitOrder[#visitOrder + 1] = nextCell
                heap:push(nextCell, nextCell.filledElevation)
            end
        end
    end

    for index = #visitOrder, 1, -1 do
        local cell = visitOrder[index]
        if cell.downCell then
            cell.downCell.flow = cell.downCell.flow + cell.flow * 0.965
        end
    end

    local threshold = riverThreshold(info.id)
    local lakeMinDepth = 0.018
    for _, cell in ipairs(visitOrder) do
        local down = cell.downCell
        local hydroSlope = 0
        if down then
            local distance = math.max(1, cell.downDistance or info.factor)
            local filledFall = math.max(0, cell.filledElevation - down.filledElevation)
            local baseFall = math.max(0, cell.elevationBase - down.elevationBase)
            hydroSlope = math.max(filledFall, baseFall * 0.25) / distance
        end
        cell.slope = clamp(math.max(cell.slope or 0, hydroSlope), 0, 1)
        local streamPowerDelta = cell.streamPowerDelta or 0
        if streamPowerDelta < 0 and not cell.mountainRangeId and (cell.plateBoundary or 0) <= 0.35 and cell.elevationBase > seaLevel then
            cell.slope = cell.slope * (1 - clamp(-streamPowerDelta * 32, 0, 0.2))
        end
        if (cell.plateBoundary or 0) > 0.35 and streamPowerDelta ~= 0 then
            cell.slope = clamp(cell.slope + clamp(math.abs(streamPowerDelta) * 5, 0, 0.035), 0, 1)
        end
        local ocean = cell.elevationBase <= seaLevel
        cell.lakeDepth = math.max(0, cell.filledElevation - cell.elevationBase)
        cell.lake = (not ocean) and cell.lakeDepth > lakeMinDepth and cell.filledElevation > seaLevel + 0.006
        if cell.cenote and not ocean then
            cell.lakeDepth = math.max(cell.lakeDepth, 0.012)
            cell.lake = true
            cell.lakeSurface = math.max(cell.filledElevation, cell.elevationBase + cell.lakeDepth)
        end
        if cell.lake then
            cell.lakeSurface = math.max(cell.lakeSurface or cell.filledElevation, cell.filledElevation)
        end
        local flowPower = math.log(cell.flow + 1)
        cell.thermalErosion = clamp((cell.slope - 0.24) * 0.12, 0, 0.07)
        local hydraulicErosion = clamp(flowPower * cell.slope * 0.035, 0, 0.22)
        cell.erosion = clamp(hydraulicErosion + cell.thermalErosion, 0, 0.24)
        cell.water = ocean or cell.lake
        local macroRiver = cell.macroChannelWeight and cell.macroChannelWeight > 0.35
        cell.river = not cell.water and cell.downCell ~= nil and (cell.flow > threshold or macroRiver)
        cell.talus = not cell.water and cell.thermalErosion > 0.006 and cell.elevationBase > seaLevel + 0.04
        local sediment = cell.sediment or 0
        local sedimentThreshold = 0.002
        local channelContext = cell.flow > threshold * 0.35 or (cell.macroChannelWeight or 0) > 0.12
        local mountainContext = cell.mountainRangeId or (cell.uplift or 0) > 0.1 or (cell.plateBoundary or 0) > 0.35
        cell.alluvialFan = not cell.water and sediment > sedimentThreshold * 2 and channelContext and mountainContext and cell.slope >= 0.04 and cell.slope < 0.12 and cell.elevationBase > seaLevel + 0.035 and cell.elevationBase < 0.5
        cell.floodplain = not cell.water and sediment > sedimentThreshold * 0.8 and channelContext and cell.slope < 0.14 and cell.elevationBase > seaLevel + 0.01 and cell.elevationBase < 0.56
        cell.deposition = sediment
        if cell.alluvialFan then cell.deposition = cell.deposition + sediment * 0.5 end
        if cell.floodplain then cell.deposition = cell.deposition + sediment * 0.75 end
    end
    region.soilProduction = SoilProduction.step(region, { dt = world.geologicTimeStep })

    local lakeGroups = labelLakeGroups(region, visitOrder, info)
    region.lakeGroups = lakeGroups
    for _, group in ipairs(lakeGroups) do
        local outlet = group.outlet
        if outlet and not outlet.water and (group.maxFlow or 0) > threshold * 0.28 then
            outlet.river = true
            outlet.floodplain = outlet.floodplain or ((outlet.sediment or 0) > 0.0016 and (outlet.slope or 0) < 0.16)
            outlet.deposition = math.max(outlet.deposition or 0, outlet.sediment or 0)
        end
    end

    for _, cell in ipairs(visitOrder) do
        if cell.river and not cell.water then
            local mouth = cell.downCell and cell.downCell.water
            local waterLevel = seaLevel
            if mouth and cell.downCell and cell.downCell.lakeSurface then waterLevel = cell.downCell.lakeSurface end
            if not mouth then
                for _, offset in ipairs(neighbors) do
                    local neighbor = region.cells[key(cell.gx + offset.x, cell.gy + offset.y)]
                    if neighbor and neighbor.water then
                        mouth = true
                        if neighbor.lakeSurface then waterLevel = neighbor.lakeSurface end
                        break
                    end
                end
            end
            cell.delta = mouth and (cell.sediment or 0) > 0.0014 and cell.flow > threshold * 0.2 and cell.slope < 0.18 and cell.elevationBase < waterLevel + 0.22
            if cell.delta then
                cell.floodplain = true
                cell.deposition = math.max(cell.deposition, (cell.sediment or 0) * 1.8)
            end
        end
    end
    applyFanLobes(region, visitOrder)
    applyBraidedRivers(visitOrder, threshold)

    region.meanders = Meander.applyRegion(region, {
        threshold = threshold,
        seed = world.seed,
        widthScale = world.meanderWidthScale,
        migrationScale = world.meanderMigrationScale,
    })

    for _, cell in ipairs(visitOrder) do
        if cell.lake then
            cell.elevation = cell.lakeSurface
        elseif cell.water then
            cell.elevation = cell.elevationBase
        else
            cell.elevation = cell.elevationBase - cell.erosion + cell.deposition
        end
    end

    region.coast = Coast.apply(region, { seaLevel = seaLevel })
    region.bathymetry = Bathymetry.applyRegion(region, { seed = world.seed, seaLevel = seaLevel })
    region.reefs = Reef.applyRegion(region, {
        seed = world.seed,
        seaLevel = seaLevel,
        geologicTime = world.geologicTime,
        zScale = world.zScale,
    })

    for _, cell in ipairs(visitOrder) do
        if cell.river then
            for _, offset in ipairs(neighbors) do
                local neighbor = region.cells[key(cell.gx + offset.x, cell.gy + offset.y)]
                if neighbor and not neighbor.water and not neighbor.river then
                    neighbor.riverBank = true
                end
            end
        end
    end

    for _, cell in ipairs(visitOrder) do
        if cell.downCell and not cell.water and cell.elevation < cell.downCell.elevation then
            cell.elevation = cell.downCell.elevation + 0.0005
        end
    end

    if world.refineLithology then
        for _, cell in ipairs(visitOrder) do
            world:refineLithology(cell)
        end
    end
    applyPaleoSeaLevel(world, visitOrder, threshold, seaLevel)
    SoilProduction.syncRegion(region)

    local stats = {
        rivers = 0,
        lakes = 0,
        lakeCells = 0,
        endorheic = 0,
        seamMismatches = 0,
        uphillRejects = 0,
        basins = 0,
        macroChannels = 0,
        lakeGroups = #lakeGroups,
        talusSlopes = 0,
        alluvialFans = 0,
        fanLobes = 0,
        floodplains = 0,
        deltas = 0,
        braidedRivers = 0,
        terraces = 0,
        marineTerraces = 0,
        fluvialTerraces = 0,
        playas = 0,
        sinkholes = 0,
        cenotes = 0,
        sedimentCells = 0,
        debrisFlowCells = region.erosion and region.erosion.debrisFlowCells or 0,
        glaciatedCells = 0,
        glacialIceVolume = region.glaciers and region.glaciers.iceVolume or 0,
        coastCliffs = 0,
        coastBeaches = 0,
        shorelineNodes = region.coast and region.coast.shorelineNodes or 0,
        shorelineCapes = region.coast and region.coast.capes or 0,
        shorelineSpits = region.coast and region.coast.spits or 0,
        shorelineLagoons = region.coast and region.coast.lagoons or 0,
        karstFeatures = region.karst and region.karst.features or 0,
        karstCells = region.karst and region.karst.affectedCells or 0,
        reefFringing = region.reefs and region.reefs.fringing or 0,
        reefBarrier = region.reefs and region.reefs.barrier or 0,
        reefAtoll = region.reefs and region.reefs.atoll or 0,
        reefLagoon = region.reefs and region.reefs.lagoon or 0,
        meanderSegments = region.meanders and region.meanders.segments or 0,
        maxMeanderSinuosity = region.meanders and region.meanders.maxSinuosity or 0,
        oxbowLakes = 0,
        maxSediment = 0,
        maxFlow = 0,
    }
    local basins = {}
    for gy = interiorMinY, interiorMaxY do
        for gx = interiorMinX, interiorMaxX do
            local cell = region.cells[key(gx, gy)]
            local root = terminal(cell)
            cell.basinId = key("b", info.id, root.gx, root.gy)
            cell.watershedId = key("w", info.id, regionX, regionY, root.gx, root.gy)
            basins[cell.basinId] = true
            if cell.lake then
                stats.lakeCells = stats.lakeCells + 1
            end
            if cell.river then stats.rivers = stats.rivers + 1 end
            if cell.lake then stats.lakes = stats.lakes + 1 end
            if cell.macroChannelId then stats.macroChannels = stats.macroChannels + 1 end
            if cell.talus then stats.talusSlopes = stats.talusSlopes + 1 end
            if cell.alluvialFan then stats.alluvialFans = stats.alluvialFans + 1 end
            if cell.alluvialFanLobe then stats.fanLobes = stats.fanLobes + 1 end
            if cell.floodplain then stats.floodplains = stats.floodplains + 1 end
            if cell.delta then stats.deltas = stats.deltas + 1 end
            if cell.braidedRiver then stats.braidedRivers = stats.braidedRivers + 1 end
            if not cell.playa and not cell.water and (cell.rainfall or cell.precipitation or 0) < 0.18 and ((cell.temperature or 0.5) - (cell.rainfall or 0)) > 0.22 and (cell.slope or 0) < 0.12 and (cell.flow or 0) < threshold * 0.9 and (cell.elevationBase or 0) < seaLevel + 0.38 then
                cell.playa = true
            end
            if cell.playa then stats.playas = stats.playas + 1 end
            if cell.sinkhole then stats.sinkholes = stats.sinkholes + 1 end
            if cell.cenote then stats.cenotes = stats.cenotes + 1 end
            if (cell.marineTerrace or 0) > 0 then stats.marineTerraces = stats.marineTerraces + 1 end
            if (cell.fluvialTerrace or 0) > 0 then stats.fluvialTerraces = stats.fluvialTerraces + 1 end
            if (cell.marineTerrace or 0) > 0 or (cell.fluvialTerrace or 0) > 0 then stats.terraces = stats.terraces + 1 end
            if cell.oxbowLake then stats.oxbowLakes = stats.oxbowLakes + 1 end
            if (cell.sediment or 0) > 0 then stats.sedimentCells = stats.sedimentCells + 1 end
            if cell.glaciated then stats.glaciatedCells = stats.glaciatedCells + 1 end
            stats.glacialIceVolume = stats.glacialIceVolume + (cell.iceThickness or 0)
            if cell.coastCliff then stats.coastCliffs = stats.coastCliffs + 1 end
            if cell.coastBeach then stats.coastBeaches = stats.coastBeaches + 1 end
            if (cell.sediment or 0) > stats.maxSediment then stats.maxSediment = cell.sediment or 0 end
            if not cell.downCell and not cell.water then stats.endorheic = stats.endorheic + 1 end
            if cell.downCell and cell.filledElevation + 0.000001 < cell.downCell.filledElevation then stats.uphillRejects = stats.uphillRejects + 1 end
            if cell.downCell and not region.cells[key(cell.downCell.gx, cell.downCell.gy)] then stats.seamMismatches = stats.seamMismatches + 1 end
            if cell.flow > stats.maxFlow then stats.maxFlow = cell.flow end
        end
    end
    for _ in pairs(basins) do stats.basins = stats.basins + 1 end
    region.stats = stats
    if world.cachePut then return world:cachePut(cacheKey, region, "hydrology") end
    world.cache[cacheKey] = region
    return region
end

function Hydrology.region(world, chunkX, chunkY, info)
    return solveRegion(world, chunkX, chunkY, info)
end

function Hydrology.cell(region, gx, gy)
    return region.cells[key(gx, gy)]
end

function Hydrology.stats(world, chunkX, chunkY, info)
    local region = solveRegion(world, chunkX, chunkY, info)
    local out = {}
    for k, v in pairs(region.stats) do out[k] = v end
    return out
end

return Hydrology
